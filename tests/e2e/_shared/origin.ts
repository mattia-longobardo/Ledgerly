// tests/e2e/_shared/origin.ts — E2E_ORIGIN: the `@smoke` tests of a release reach the site's origin,
// Traefik's `web` entrypoint, and not Cloudflare, whose rate limit one run of them passes.
//
// The browser and the scripts keep talking to https://dash.longobardo.me — the same Host, the same
// Secure cookies, the same sign-in — through this proxy (playwright.config.ts, `proxy`). For the
// site it answers TLS itself, with a certificate made for the run, and hands each request to the
// origin as plain HTTP, as the tunnel does: Traefik tells the app the request is https. Any other
// host passes through untouched. Nothing of Traefik or Cloudflare changes.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";

const DIR = "test-results/origin";

/** Starts the proxy on `127.0.0.1:<port>`; resolves to the function that stops it. */
export async function startOriginProxy(
  origin: string,
  host: string,
  port: number,
): Promise<() => Promise<void>> {
  mkdirSync(DIR, { recursive: true });
  // A certificate for this run only: the browser and the scripts are told to accept it.
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${host}`,
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      `${DIR}/key.pem`,
      "-out",
      `${DIR}/cert.pem`,
    ],
    { stdio: "ignore" },
  );
  const secure = { key: readFileSync(`${DIR}/key.pem`), cert: readFileSync(`${DIR}/cert.pem`) };

  const site = http.createServer((request, response) => {
    const upstream = http.request(
      { host: origin, port: 80, method: request.method, path: request.url, headers: request.headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(response);
      },
    );
    upstream.on("error", () => response.destroy());
    request.pipe(upstream);
  });

  const proxy = http.createServer((_request, response) => response.writeHead(405).end());
  proxy.on("connect", (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const [name, port = "443"] = (request.url ?? "").split(":");
    socket.on("error", () => socket.destroy());
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    if (head.length > 0) socket.unshift(head);
    if (name === host) {
      site.emit("connection", new tls.TLSSocket(socket, { isServer: true, ...secure }));
      return;
    }
    const onward = net.connect(Number(port), name, () => socket.pipe(onward).pipe(socket));
    onward.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => proxy.listen(port, "127.0.0.1", resolve));
  return () => new Promise<void>((resolve) => proxy.close(() => resolve()));
}
