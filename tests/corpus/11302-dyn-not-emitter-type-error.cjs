'use strict';
// A plain object or a non-emitter class instance in an untyped slot keeps
// Node's TypeError for a missing method: the emitter path must not claim it.
class Plain { constructor() { this.v = 1; } }
function tryOn(src) {
  try {
    src.on('ping', () => {});
    console.log('no throw');
  } catch (e) {
    console.log(e instanceof TypeError, e.message);
  }
}
tryOn(new Plain());
tryOn({ v: 2 });
tryOn(5);
tryOn('str');
