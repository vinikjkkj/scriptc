// The zlib decompressor Transform in the three shapes a consumer reaches
// for besides pipeline(): .pipe() into a sink, stream/promises pipeline,
// and destroy(err) partway through. The last is the one a streaming
// history-sync consumer actually runs on failure — it tears the inflater
// down mid-member, which must release the z_stream without emitting the
// rest of the payload.
import { PassThrough, Readable, Transform, pipeline } from "node:stream";
import { pipeline as pipelineAsync } from "node:stream/promises";
import { createGunzip, createUnzip, gzipSync } from "node:zlib";

function payload(): string {
  const parts: string[] = [];
  for (let i = 0; i < 3000; i++) parts.push("chunk " + i + " of a history sync conversation\n");
  return parts.join("");
}

function slices(buf: Buffer, n: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += n) {
    out.push(buf.subarray(i, Math.min(i + n, buf.length)));
  }
  return out;
}

async function main(): Promise<void> {
  const text = payload();
  const gz = gzipSync(Buffer.from(text, "utf8"));

  // 1. .pipe() into a PassThrough sink, counted on 'data'.
  await new Promise<void>((resolve) => {
    const unzip = createUnzip();
    const sink = new PassThrough();
    let n = 0;
    sink.on("data", (c: Buffer) => {
      n += c.length;
    });
    sink.on("end", () => {
      console.log("pipe bytes:", n, "match:", n === text.length);
      resolve();
    });
    unzip.pipe(sink);
    for (const s of slices(gz, 800)) unzip.write(s);
    unzip.end();
  });

  // 2. stream/promises pipeline, awaited — the shape that reports failure
  //    by rejection instead of by callback.
  const sink = new PassThrough();
  let piped = 0;
  sink.on("data", (c: Buffer) => {
    piped += c.length;
  });
  await pipelineAsync(Readable.from(slices(gz, 300)), createGunzip(), sink);
  console.log("promises pipeline match:", piped === text.length);

  // 3. The awaited pipeline REJECTS when the source is truncated.
  try {
    const drop = new PassThrough();
    drop.on("data", () => undefined);
    await pipelineAsync(
      Readable.from(slices(gz.subarray(0, gz.length - 60), 300)),
      createUnzip(),
      drop,
    );
    console.log("truncated pipeline resolved (unreached)");
  } catch (err) {
    console.log("truncated pipeline rejected:", (err as Error).message);
  }

  // 4. destroy(err) partway through: the consumer stops reading and tears
  //    the inflater down. The error reaches the 'error' handler, the
  //    stream reports destroyed, and no further chunk arrives.
  await new Promise<void>((resolve) => {
    const unzip: Transform = createUnzip();
    let chunks = 0;
    let stopped = false;
    unzip.on("data", (c: Buffer) => {
      chunks += 1;
      void c;
      if (!stopped) {
        stopped = true;
        unzip.destroy(new Error("consumer gave up"));
      }
    });
    unzip.on("error", (err: Error) => {
      console.log("destroy error:", err.message);
    });
    unzip.on("close", () => {
      console.log("destroyed:", unzip.destroyed, "chunks after stop:", chunks);
      resolve();
    });
    pipeline(Readable.from(slices(gz, 4096)), unzip, () => undefined);
  });

  // 5. Two independent inflaters alive at once, interleaved: the z_stream
  //    is per-instance, so neither sees the other's window.
  const first = createUnzip();
  const second = createUnzip();
  pipeline(Readable.from(slices(gzipSync(Buffer.from("alpha")), 2)), first, () => undefined);
  pipeline(Readable.from(slices(gzipSync(Buffer.from("beta")), 2)), second, () => undefined);
  const a: string[] = [];
  for await (const c of first) a.push((c as Buffer).toString("utf8"));
  const b: string[] = [];
  for await (const c of second) b.push((c as Buffer).toString("utf8"));
  console.log("interleaved:", a.join("") + "/" + b.join(""));
}

main();
