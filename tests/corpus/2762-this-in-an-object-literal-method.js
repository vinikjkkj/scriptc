// `this` inside an object-literal METHOD, and the receiver that makes the
// answer true. Two halves of one rule, and neither is sound alone.
//
// (a) THE WALK. A body written as an object-literal method gets no
//     receiver, so a `this` that is lexically the METHOD's stays fenced.
//     A `this` inside a plain function the body DECLARES is not the
//     method's — JS resets `this` at a function boundary — and the
//     compiler already lowers that one to the ambient receiver. The walk
//     used to refuse the whole method body for it, which on a bundled
//     `__commonJS` module table takes the whole module down.
//
// (b) THE RECEIVER. `api.bump(1)` on an untyped receiver has to bind
//     `api` as `this`. Without it (a) converts a located fence into a
//     wrong value, so this file drives both or it proves nothing.
'use strict';

function dyn(v) { return v; } // an identity that erases static types

// The bundler shape: a module body written as a SHORTHAND METHOD of an
// object literal whose contextual type is `any`. Every `this` below
// belongs to a function EXPRESSION this body declares.
const mod = dyn({
  writer(exports) {
    exports.api = {
      len: 0,
      tag: 'w',
      bump: function (n) {
        this.len = this.len + n;
        return this.len;
      },
      kind: function () {
        return typeof this.bump;
      },
      who: function () {
        return this.tag + '/' + this.len;
      },
    };
  },
});

const box = dyn({});
mod.writer(box);
const api = box.api;

console.log('bump', api.bump(1), api.bump(127), api.bump(128));
console.log('len', api.len);
console.log('kind', api.kind());
console.log('who', api.who());

// THE NEGATIVE CONTROL. One function value, three receivers. A dropped
// receiver throws on `undefined`; a receiver bound to the wrong object —
// the last one built, the first one seen — makes two of these three agree.
// They must not: each answer names its own object, and re-asking the first
// one after the others have run must still answer the first one.
function label() { return this.name + ':' + this.n; }
const x = dyn({ name: 'x', n: 1, label: label });
const y = dyn({ name: 'y', n: 2, label: label });
const z = dyn({ name: 'z', n: 3, label: label, echo: function () { return this.label(); } });
console.log('x', x.label());
console.log('y', y.label());
console.log('z', z.echo());
console.log('x-again', x.label());

// A receiver whose member is NOT a function keeps Node's exact catchable
// TypeError, and a nullish receiver keeps the property-read one.
try {
  x.n();
} catch (e) {
  console.log('caught:', e instanceof TypeError, e.message);
}
try {
  const nothing = dyn(undefined);
  nothing.label();
} catch (e) {
  console.log('caught:', e instanceof TypeError, e.message);
}

console.log('done');
