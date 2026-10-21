// A method implemented with a SUBCLASS parameter where the interface slot
// names the base class (bivariant method parameters: tsc admits it). The
// instance is passed by reference, so the callee receives the very object
// through a checked narrow; a value that is not the subclass throws the
// TypeError Node throws when the subclass member is used.
class Animal {
  name = "a";
}
class Dog extends Animal {
  bark(): string {
    return "woof " + this.name;
  }
}
class Puppy extends Dog {
  tiny = true;
}
interface Handler {
  on(x: Animal): void;
}
const h: Handler = {
  on(x: Dog) {
    console.log(x.bark());
  },
};
h.on(new Dog());
h.on(new Puppy());
try {
  h.on(new Animal());
} catch (e) {
  console.log("caught", e instanceof TypeError);
}
const seen: string[] = [];
const g: Handler = {
  on(x: Puppy) {
    seen.push(x.name + (x.tiny ? "!" : "?"));
  },
};
g.on(new Puppy());
console.log(seen.join(","));
