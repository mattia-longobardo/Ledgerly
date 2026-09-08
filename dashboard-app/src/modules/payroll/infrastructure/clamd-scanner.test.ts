import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClamdScanner, parseClamdReply } from "./clamd-scanner";

let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

/**
 * A real socket, not a mock: the whole point of this adapter is the wire
 * framing (a 4-byte big-endian length prefix per chunk, terminated by a
 * zero-length chunk), and a mocked socket would let a wrong frame pass.
 */
async function listen(handler: (socket: Socket, received: Buffer[]) => void): Promise<number> {
  server = createServer((socket) => {
    const received: Buffer[] = [];
    socket.on("data", (chunk) => {
      received.push(chunk);
      handler(socket, received);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as { port: number }).port;
}

const bytes = new TextEncoder().encode("%PDF-1.7 payload");
const COMMAND = "zINSTREAM\0";

describe("parseClamdReply", () => {
  it("reads a clean reply", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ verdict: "clean", scanner: "clamd", signature: null });
  });

  it("reads an infected reply and keeps the signature name", () => {
    expect(parseClamdReply("stream: Eicar-Test-Signature FOUND\0")).toEqual({
      verdict: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
  });

  it("treats an ERROR reply as unavailable, never as clean", () => {
    expect(parseClamdReply("stream: size limit exceeded ERROR\0")).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });

  it("treats anything it does not recognise as unavailable — the safe direction", () => {
    expect(parseClamdReply("gibberish")).toEqual({ verdict: "unavailable", scanner: "clamd", signature: null });
  });
});

describe("createClamdScanner", () => {
  it("sends the zINSTREAM command, then length-prefixed chunks, then a zero terminator", async () => {
    let captured: Buffer = Buffer.alloc(0);
    const expectedLength = COMMAND.length + 4 + bytes.byteLength + 4;
    const port = await listen((socket, received) => {
      captured = Buffer.concat(received);
      if (captured.length >= expectedLength) socket.end("stream: OK\0");
    });
    const result = await createClamdScanner({ host: "127.0.0.1", port }).scan(bytes);
    expect(result).toEqual({ verdict: "clean", scanner: "clamd", signature: null });
    expect(captured.subarray(0, COMMAND.length).toString()).toBe(COMMAND);
    expect(captured.readUInt32BE(COMMAND.length)).toBe(bytes.byteLength);
    expect(captured.subarray(COMMAND.length + 4, COMMAND.length + 4 + bytes.byteLength)).toEqual(Buffer.from(bytes));
    expect(captured.readUInt32BE(COMMAND.length + 4 + bytes.byteLength)).toBe(0);
  });

  it("reports infected with the signature clamd named", async () => {
    const port = await listen((socket) => socket.end("stream: Eicar-Test-Signature FOUND\0"));
    expect(await createClamdScanner({ host: "127.0.0.1", port }).scan(bytes)).toEqual({
      verdict: "infected",
      scanner: "clamd",
      signature: "Eicar-Test-Signature",
    });
  });

  it("answers unavailable — never clean — when nothing is listening", async () => {
    // Port 1 on loopback refuses immediately on every supported platform.
    expect(await createClamdScanner({ host: "127.0.0.1", port: 1, timeoutMs: 500 }).scan(bytes)).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });

  it("answers unavailable when the server accepts and then says nothing before the timeout", async () => {
    const port = await listen(() => {
      /* deliberately never replies */
    });
    expect(await createClamdScanner({ host: "127.0.0.1", port, timeoutMs: 200 }).scan(bytes)).toEqual({
      verdict: "unavailable",
      scanner: "clamd",
      signature: null,
    });
  });
});
