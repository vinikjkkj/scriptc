// A project tsconfig with strictPropertyInitialization OFF (strict: false;
// strictNullChecks stays on): tsc no longer verifies that initializer-less
// fields are assigned in the constructor, so a field assigned only in a
// method reads undefined until that method runs. A Map field included.
class Ok {
  n: number;
  s: string;
  constructor(n: number) {
    this.n = n;
    this.s = "ok";
  }
}

class Bad {
  v: number;
  m(): void {
    this.v = 1;
  }
}

class Worse {
  m: Map<string, number>;
  fill(): void {
    this.m = new Map([["a", 1]]);
  }
}

console.log(new Ok(5).n);
const bad = new Bad();
console.log(bad.v);
bad.m();
console.log(bad.v);
const worse = new Worse();
console.log(worse.m === undefined);
worse.fill();
console.log(worse.m.get("a"));
