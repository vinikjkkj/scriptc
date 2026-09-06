// zapo's streaming protobuf reader, reduced to the shape that used to be
// rejected outright: a CLASS whose private field is declared
// `AsyncIterator<unknown>` and is filled from a stream's
// `[Symbol.asyncIterator]()`, then pulled inside an async method to keep a
// growing buffer topped up. The rejection was on the FIELD DECLARATION —
// the class had no lowering at all, so every construction and every method
// call on it cascaded — which is why the whole reader is rebuilt here
// rather than just the field.
import { Readable } from "node:stream";

class ChunkReader {
  private readonly iterator: AsyncIterator<unknown>;
  private buffer: Uint8Array;
  private readPos = 0;
  private writePos = 0;
  public consumed = 0;

  public constructor(source: Readable) {
    this.iterator = source[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    this.buffer = new Uint8Array(8);
  }

  public get buffered(): number {
    return this.writePos - this.readPos;
  }

  // The pull: keep taking chunks until the buffer holds `byteLength`, or
  // report the stream ended. `next.done === true` is the EOF test and
  // `next.value` is the chunk, both read off the IteratorResult record.
  public async ensure(byteLength: number): Promise<boolean> {
    while (this.buffered < byteLength) {
      const next = await this.iterator.next();
      if (next.done === true) {
        return false;
      }
      const chunk = next.value as Buffer;
      if (chunk.byteLength === 0) {
        continue;
      }
      this.reserve(chunk.byteLength);
      this.buffer.set(chunk, this.writePos);
      this.writePos += chunk.byteLength;
    }
    return true;
  }

  public tryReadExact(byteLength: number): Uint8Array | null {
    if (this.buffered < byteLength) {
      return null;
    }
    const start = this.readPos;
    this.readPos += byteLength;
    this.consumed += byteLength;
    return this.buffer.subarray(start, start + byteLength);
  }

  public async readExact(byteLength: number): Promise<Uint8Array> {
    if (!(await this.ensure(byteLength))) {
      throw new Error("unexpected end of stream");
    }
    const taken = this.tryReadExact(byteLength);
    if (taken === null) {
      throw new Error("unreachable: ensure said there were bytes");
    }
    return taken;
  }

  private reserve(incomingBytes: number): void {
    if (this.writePos + incomingBytes <= this.buffer.byteLength) {
      return;
    }
    const live = this.writePos - this.readPos;
    if (this.readPos > 0 && live + incomingBytes <= this.buffer.byteLength) {
      this.buffer.set(this.buffer.subarray(this.readPos, this.writePos), 0);
      this.writePos -= this.readPos;
      this.readPos = 0;
      return;
    }
    let grown = this.buffer.byteLength;
    while (grown < live + incomingBytes) {
      grown *= 2;
    }
    console.log("reader: growing to", grown);
    const next = new Uint8Array(grown);
    next.set(this.buffer.subarray(this.readPos, this.writePos));
    this.writePos -= this.readPos;
    this.readPos = 0;
    this.buffer = next;
  }
}

function chunks(parts: readonly string[]): Readable {
  let i = 0;
  return new Readable({
    read(): void {
      if (i < parts.length) {
        this.push(Buffer.from(parts[i]!, "utf8"));
        i += 1;
      } else {
        this.push(null);
      }
    },
  });
}

function text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

async function main(): Promise<void> {
  // Reads that span chunk boundaries and force the buffer to compact and
  // then grow — the reason the reader owns the iterator instead of looping
  // over it.
  const r = new ChunkReader(chunks(["abcd", "efgh", "ijklmnop", "qr"]));
  console.log("read 3:", text(await r.readExact(3)));
  console.log("read 6:", text(await r.readExact(6)));
  console.log("read 9:", text(await r.readExact(9)));
  console.log("consumed:", r.consumed, "buffered:", r.buffered);

  // Past the end: ensure reports false and readExact turns that into the
  // reader's own error.
  const short = new ChunkReader(chunks(["xy"]));
  console.log("ensure 2:", await short.ensure(2));
  try {
    await short.readExact(9);
    console.log("NO THROW");
  } catch (e) {
    console.log("caught:", (e as Error).message);
  }

  // An empty stream: the very first pull is already done.
  const empty = new ChunkReader(chunks([]));
  console.log("empty ensure:", await empty.ensure(1));
}

void main();
