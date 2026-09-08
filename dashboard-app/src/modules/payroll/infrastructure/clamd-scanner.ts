import { connect as netConnect, type Socket } from "node:net";
import type { MalwareScanner, ScanResult } from "../application/ports";

export type ClamdConnect = (host: string, port: number) => Socket;

export interface ClamdConfig {
  host: string;
  port: number;
  /** Covers connect, send and reply together. Default 30 s. */
  timeoutMs?: number;
  /** Injected only by a test that needs a socket it controls. */
  connect?: ClamdConnect;
}

/** The literal `zINSTREAM` followed by one NUL byte, per the clamd protocol. */
const COMMAND = "zINSTREAM\0";

const CLEAN = /:\s*OK$/;
const FOUND = /:\s*(.+?)\s+FOUND$/;
const ERRORED = /\bERROR$/;

/**
 * clamd's `INSTREAM` reply is one NUL-terminated line. Everything that is not an
 * explicit `OK` or `FOUND` — including `ERROR`, including a reply this code has
 * never seen — is `unavailable`, never `clean`. That asymmetry is the whole
 * safety property: an unrecognised reply must leave the import in `scanning`
 * for a later tick, not wave it through into the parsing pipeline.
 */
export function parseClamdReply(reply: string): ScanResult {
  const line = reply.replace(/\0/g, "").trim();
  if (CLEAN.test(line)) return { verdict: "clean", scanner: "clamd", signature: null };
  const found = FOUND.exec(line);
  if (found && !ERRORED.test(line)) return { verdict: "infected", scanner: "clamd", signature: found[1]! };
  return { verdict: "unavailable", scanner: "clamd", signature: null };
}

/**
 * clamd `zINSTREAM` over TCP (spec §2.5). The wire format is the NUL-terminated
 * command, then any number of chunks each prefixed by its length as a 4-byte
 * big-endian integer, then a zero-length chunk to end the stream.
 *
 * Every failure path — refused connection, timeout, socket error, a reply that
 * does not parse — resolves to `unavailable`. It never rejects: a scanner that
 * threw would make `ingestImport` choose between catching an unknown error and
 * treating an outage as a rejection, and both of those are worse than one
 * explicit verdict the pipeline already knows how to retry (Ruling R4-2).
 */
export function createClamdScanner(config: ClamdConfig): MalwareScanner {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const open = config.connect ?? ((host, port) => netConnect({ host, port }));

  return {
    scan(bytes: Uint8Array): Promise<ScanResult> {
      return new Promise<ScanResult>((resolve) => {
        const socket = open(config.host, config.port);
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (result: ScanResult) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };

        const unavailable = () => finish({ verdict: "unavailable", scanner: "clamd", signature: null });
        const replyOrUnavailable = () => {
          if (chunks.length === 0) return unavailable();
          finish(parseClamdReply(Buffer.concat(chunks).toString("utf8")));
        };

        socket.setTimeout(timeoutMs, unavailable);
        socket.on("error", unavailable);
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.on("end", replyOrUnavailable);
        socket.on("close", replyOrUnavailable);

        socket.on("connect", () => {
          const length = Buffer.alloc(4);
          length.writeUInt32BE(bytes.byteLength, 0);
          const terminator = Buffer.alloc(4); // four zero bytes: the end-of-stream chunk
          socket.write(Buffer.concat([Buffer.from(COMMAND, "binary"), length, Buffer.from(bytes), terminator]));
        });
      });
    },
  };
}
