// Class declarations written inside functions and blocks. A local class that
// captures no enclosing local, carries no static state and is used only in
// ways one evaluation cannot be told from many (new, extends, a static-method
// call, or anything at all inside a block evaluated once) is the same class
// at module level: two functions declaring `P` keep two distinct classes,
// `super` reaches the sibling local base, and a stream class declared in a
// block is read through R.read / R.once handlers. Node is the oracle.
const { Readable } = require("stream");

function a() {
  class P {
    who() {
      return "a.P";
    }
  }
  return new P().who();
}
function b() {
  class P {
    who() {
      return "b.P";
    }
  }
  class Q extends P {
    who() {
      return "Q>" + super.who();
    }
  }
  return new Q().who();
}
console.log(a(), b(), a());

function withStatic() {
  class S {
    static one() {
      return 1;
    }
    val() {
      return S.one() + 1;
    }
  }
  return S.one() + new S().val();
}
console.log(withStatic());

{
  class Box {
    constructor(v) {
      this.v = v;
    }
  }
  const x = new Box(1);
  console.log(x instanceof Box, x, Box.name, [new Box(2)]);
  function mk() {
    return new Box(3);
  }
  console.log(mk().v);
}

{
  class R extends Readable {
    _read() {
      this.push("chunk");
      this.push(null);
    }
  }
  function onRead() {
    const c = stream.read();
    console.log("read", c === null ? -1 : c.length);
  }
  const stream = new R();
  stream.once("readable", onRead);
  stream.on("end", () => console.log("end"));
}
