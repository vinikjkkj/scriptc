import { Readable } from "node:stream";

// A class that inherits the stream constructor takes Node's options bag through it. A construction through a
// class VALUE that names arguments has nowhere to put them, so it is refused like the direct spelling.
class Plain extends Readable {
  _read(): void {
    this.push(null);
  }
}
const K = Plain;
const t = new K({ objectMode: true });
void t;
