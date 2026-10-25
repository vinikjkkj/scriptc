// An Error subclass projected into a record that reads the inherited message
// (a runtime slot) and an own name field; a ternary of two instances into one
// record slot, then String() of the original instance.
interface Shown {
  name: string;
  message: string;
}
class Tagged extends Error {
  readonly name: string = 'tagged';
  constructor(message: string) {
    super(message);
  }
}
class Quiet extends Error {
  readonly name: string = 'quiet';
  constructor(message: string) {
    super(message);
  }
}
for (let k = 0; k < 2; k++) {
  const s: Shown = k === 0 ? new Tagged('first') : new Quiet('second');
  console.log(s.name, s.message);
}
const t = new Tagged('third');
const view: Shown = t;
console.log(view.name, view.message, String(t), t instanceof Error);
