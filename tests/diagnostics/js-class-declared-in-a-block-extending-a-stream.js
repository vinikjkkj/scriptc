// OPEN DEFECT, pinned as the refusal it is. A class declared inside a block
// (or function) that extends a stream class, whose instance is read through
// R.read / R.once handlers, has no static lowering. This used to compile: the
// statement became a runtime fence and the capture box was rewritten to an
// inert placeholder (inheritance.test.ts asserted the emitted C). It is a
// build error now.
const { Readable } = require("stream");
{
  class R extends Readable {
    _read() { this.push(null); }
  }
  function onRead() { stream.read(); }
  const stream = new R();
  stream.once("readable", onRead);
}
