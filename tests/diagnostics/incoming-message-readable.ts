// The fences an IncomingMessage KEEPS now that it is a Readable to tsc.
// The positive half is tests/corpus/3831 and tests/corpus/3832.
//
// Making the fallback's IncomingMessage extend Readable brought the whole
// Readable surface with it, and only one thing about it is implemented:
// the CONVERSION into a `Readable` SLOT. Everything else must still
// refuse, and refuse by NAME rather than by falling into a generic
// handle fence — a response is not a Writable, not a Duplex, not a user
// subclass of Readable, and the members the view does not carry are not
// silently answered.
import * as http from "node:http";
import { Duplex, Readable, Writable } from "node:stream";

const url = "http://127.0.0.1:9/";

// A response is READ-only: the writable half has no source here, and the
// Duplex slot wants both halves.
function intoWritable(w: Writable): void { console.log(w.writableLength); }
function intoDuplex(d: Duplex): void { console.log(d.readableLength); }

// A user subclass of Readable is a bigger struct with its own fields —
// the view allocates the runtime one, so this is a downcast and not a
// widening.
class MyReadable extends Readable {
  _read(): void { this.push(null); }
}
function intoSubclass(r: MyReadable): void { console.log(r.readableLength); }

http.request(url, {}, (res) => {
  intoWritable(res as unknown as Writable);
  intoDuplex(res as unknown as Duplex);
  intoSubclass(res as unknown as MyReadable);
  // The Readable members the view does not implement: they TYPECHECK now
  // (the interface inherits them) and must fence at the use site.
  res.push(Buffer.from("x"));
  console.log(res.read(1));
  res.unshift(Buffer.from("y"));
  console.log(res.isPaused());
});
