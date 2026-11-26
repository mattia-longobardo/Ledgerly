/**
 * Reads a stream until it ends or holds more than `limit` bytes (SEC-02): then it stops and returns
 * `limit + 1` bytes, enough for the caller to refuse the file as too large without holding it all.
 */
export async function readCapped(stream: AsyncIterable<Uint8Array | string>, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    size += bytes.byteLength;
    // Leaving the loop closes the stream: nothing past the limit is read.
    if (size > limit) return Buffer.concat(chunks).subarray(0, limit + 1);
  }
  return Buffer.concat(chunks);
}
