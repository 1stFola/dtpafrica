import { SmallObjectTooLargeError } from "./object-store";

/** Bound the bytes accumulated even when object metadata changed between HEAD and GET. */
export async function readBoundedBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("A small-object read limit must be a positive integer.");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new SmallObjectTooLargeError(maxBytes);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}
