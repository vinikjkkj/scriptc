// The `get name()` routing stamps a CONSTANT into ScrError's inherited
// `name` slot. Node answers that property through a prototype accessor
// with NO setter, so a write through an `Error` view throws (or, in a
// sloppy-mode module, silently does nothing) where the slot would store —
// the one place the two shapes disagree. A program containing such a write
// keeps the fence, whole-program: a refusal, never a wrong answer.
class Tagged extends Error {
  override get name(): string {
    return 'Tagged';
  }
}

const e = new Tagged('boom');
const view: Error = e;
view.name = 'Renamed';
console.log(e.name);
