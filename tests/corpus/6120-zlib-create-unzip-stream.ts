// node:zlib's STREAMING decompressors. createUnzip/createGunzip/
// createInflate/createInflateRaw each answer a Transform holding a
// z_stream that survives between writes, which is the whole point: a
// deflate block split across a chunk boundary must resume on the next
// chunk, so every case here feeds the compressed bytes in SLICES rather
// than whole. Covers auto-detection (gzip vs zlib framing), concatenated
// gzip members, truncated input, corrupt input, and the empty stream.
//
// Nothing here prints a COMPRESSED size or a partial byte count: the two
// lanes link different zlib builds, whose deflate output differs by a
// hundred bytes on the same input, and a count taken before an error also
// depends on stream scheduling. Round trips and error messages are what
// both lanes must agree on, so those are what this asserts.
import { Readable, Transform, pipeline } from "node:stream";
import {
  createGunzip,
  createInflate,
  createInflateRaw,
  createUnzip,
  deflateRawSync,
  deflateSync,
  gzipSync,
} from "node:zlib";

// Big enough that the deflate output spans many slices and the inflate
// output spans several of the runtime's 16 KiB blocks.
function payload(): string {
  const parts: string[] = [];
  for (let i = 0; i < 4000; i++) parts.push("line " + i + " of the streamed history sync\n");
  return parts.join("");
}

function slices(buf: Buffer, n: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += n) {
    out.push(buf.subarray(i, Math.min(i + n, buf.length)));
  }
  return out;
}

// Drives one decompressor to completion. An error wins over the output:
// what a failing stream delivered before it failed is scheduling-
// dependent, so only the message is reported.
async function drain(src: Buffer[], t: Transform): Promise<string> {
  let failed: string | null = null;
  t.on("error", (err: Error) => {
    if (failed === null) failed = err.message;
  });
  pipeline(Readable.from(src), t, (err: Error | null) => {
    if (err && failed === null) failed = err.message;
  });
  const parts: string[] = [];
  try {
    for await (const chunk of t) parts.push((chunk as Buffer).toString("utf8"));
  } catch (err) {
    if (failed === null) failed = (err as Error).message;
  }
  return failed !== null ? "ERR(" + failed + ")" : parts.join("");
}

async function main(): Promise<void> {
  const text = payload();
  const buf = Buffer.from(text, "utf8");

  // 1. gzip through createUnzip, seven bytes at a time — every chunk
  //    boundary lands inside a deflate block.
  const gz = gzipSync(buf);
  const a = await drain(slices(gz, 7), createUnzip());
  console.log("unzip/gzip len:", a.length, "match:", a === text);

  // 2. the SAME auto-detecting stream over zlib framing.
  const zl = deflateSync(buf);
  console.log("unzip/zlib match:", (await drain(slices(zl, 13), createUnzip())) === text);

  // 3. createGunzip demands the gzip header.
  console.log("gunzip match:", (await drain(slices(gz, 1024), createGunzip())) === text);

  // 4. createInflate over zlib framing, createInflateRaw over headerless.
  console.log("inflate match:", (await drain(slices(zl, 99), createInflate())) === text);
  const raw = deflateRawSync(buf);
  console.log("inflateRaw match:", (await drain(slices(raw, 99), createInflateRaw())) === text);

  // 5. CONCATENATED gzip members — Node's gunzip inflates the sequence,
  //    and so does the auto-detecting unzip once it has picked gzip.
  const two = Buffer.concat([gzipSync(Buffer.from("first ")), gzipSync(Buffer.from("second"))]);
  console.log("multi-member gunzip:", await drain(slices(two, 3), createGunzip()));
  console.log("multi-member unzip:", await drain(slices(two, 5), createUnzip()));

  // 6. TRUNCATED input: the stream ends mid-member. Where the cut lands
  //    depends on the compressor, but 40 bytes off a nine-kilobyte member
  //    is inside the deflate data either way.
  console.log("truncated:", await drain(slices(gz.subarray(0, gz.length - 40), 512), createUnzip()));

  // 7. CORRUPT input, from a FIXED byte pattern rather than a mangled
  //    compressor output: a bare gzip header over 'A's, so both lanes
  //    inflate the same bytes and must report the same zlib message.
  const corrupt = Buffer.concat([
    Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]),
    Buffer.alloc(64, 0x41),
  ]);
  console.log("corrupt:", await drain(slices(corrupt, 9), createUnzip()));

  // 8. The EMPTY stream errors rather than ending clean — Node's shape.
  console.log("empty:", await drain([], createUnzip()));

  // 9. The writable half driven directly, readable half on 'data': the
  //    write()/end() path rather than pipeline().
  const direct = createUnzip();
  let seen = 0;
  direct.on("data", (chunk: Buffer) => {
    seen += chunk.length;
  });
  direct.on("end", () => console.log("direct write/end bytes:", seen, "expected:", buf.length));
  for (const s of slices(gz, 555)) direct.write(s);
  direct.end();
}

main();
