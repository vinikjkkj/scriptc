/* `var p` with no initializer is implicitly `any` -- a dyn slot -- and
 * tsc's control flow narrows every read after `p = new C(...)` to C. The
 * lowering built the class fieldGet on the NARROWED type over a value that
 * was still dyn, and the module failed IR validation:
 *
 *   SC9001 internal compiler error: fieldGet receiver: expected object,
 *   got dyn
 *
 * postgres-array/index.js:71 is the shape (`var character, parser, quote`,
 * then `parser = new ArrayParser(...)`, then `parser.position`), and it is
 * the ordinary spelling of an optional local in hand-written JS. The read
 * now bridges through the same validated dynCheck extraction the written
 * cast `(p as C).f` already used -- identity and mutation preserved. */
'use strict';

class Node2 {
  constructor(n) {
    this.position = n;
  }

  get doubled() {
    return this.position * 2;
  }

  run(nested) {
    var ch, parser;
    var out = 0;
    for (var i = 0; i < 2; i++) {
      ch = i;
      if (ch === 0 && !nested) {
        parser = new Node2(this.position + 1);
        out += parser.position - 2;
        out += parser.doubled;
        parser.position = parser.position + 10;
        out += parser.position;
      }
    }
    return out;
  }
}

console.log(new Node2(5).run(false));
console.log(new Node2(5).run(true));

function aliasIdentity() {
  var a;
  a = new Node2(1);
  var b = a;
  b.position = 42;
  return a.position;
}

console.log(aliasIdentity());
