// The `get name()` routing is off for any program that ASSIGNS to a
// `.name` on an %Error-rooted receiver (Node throws there; a slot would
// store). The gate is RECEIVER-TYPED: writes to some other `.name` — a
// record's, a class's own — leave the routing alone.
class Tagged extends Error {
  override get name(): string {
    return 'Tagged';
  }
}

interface Person {
  name: string;
  age: number;
}
const p: Person = { name: 'ada', age: 36 };
p.name = 'grace';

class Box {
  name = 'box';
  rename(to: string): void {
    this.name = to;
  }
}
const b = new Box();
b.rename('crate');
b.name = b.name + '!';

const e = new Tagged('boom');
console.log(p.name, b.name);
console.log(e.name, String(e));
