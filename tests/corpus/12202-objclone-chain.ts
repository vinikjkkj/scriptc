// Clone of a clone, and the clone of a field read, each still an instance of
// the class; the scalar fields diverge while the shared object stays shared.
class Session {
  id: number;
  user: string;
  labels: string[];
  constructor(id: number, user: string) {
    this.id = id;
    this.user = user;
    this.labels = [];
  }
  describe(): string {
    return `${this.user}#${this.id}[${this.labels.join("|")}]`;
  }
}

class Holder {
  current: Session;
  constructor(s: Session) {
    this.current = s;
  }
  snapshot(): Session {
    const { current } = this;
    return Object.create(Object.getPrototypeOf(current), Object.getOwnPropertyDescriptors(current));
  }
}

const base = new Session(1, "ana");
const h = new Holder(base);
const first = h.snapshot();
const second: Session = Object.create(Object.getPrototypeOf(first), Object.getOwnPropertyDescriptors(first));
first.id = 2;
second.user = "bia";
second.labels.push("x");
console.log(first instanceof Session, second instanceof Session, base instanceof Session);
console.log(base.describe(), first.describe(), second.describe());
console.log(first.labels === base.labels, second.labels === base.labels);
console.log(Object.keys(second).length, Object.keys(base).join(","));
console.log(h.current === base, h.current.id, first.describe() === second.describe());
// Untyped (checker `any`) clone: the dyn box of the same class.
const third = Object.create(Object.getPrototypeOf(second), Object.getOwnPropertyDescriptors(second));
console.log(third instanceof Session, third.user, third.id);
