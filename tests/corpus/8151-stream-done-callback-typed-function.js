// The completion callback of a stream's underscore methods arrives in a
// parameter the author typed `Function` (JSDoc), not as the declared
// `(error?) => void`: ws's Receiver._write is written this way.
import { Writable, Transform } from 'node:stream';

class Sink extends Writable {
  constructor() {
    super();
    this.seen = [];
  }

  /**
   * @param {Buffer} chunk
   * @param {String} encoding
   * @param {Function} cb
   */
  _write(chunk, encoding, cb) {
    this.seen.push(chunk.toString());
    cb();
  }

  /**
   * @param {Function} cb
   */
  _final(cb) {
    this.seen.push('final');
    cb();
  }
}

const s = new Sink();
s.write('one');
s.write('two');
s.end(() => {
  console.log(s.seen.join(','));
});
