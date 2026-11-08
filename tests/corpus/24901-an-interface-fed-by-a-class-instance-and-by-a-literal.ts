// An interface fed by a class instance in one place and by a plain object literal in another: the instance keeps its identity, its own fields and its
// class, the literal keeps its own members, and keys, identity and instanceof answer what Node answers for each.
interface Chain {
  get(key: string): Chain;
  exec(): string[];
}
class Pipeline {
  queue: string[] = [];
  label = "pipe";
  get(key: string): Pipeline {
    this.queue.push(key);
    return this;
  }
  exec(): string[] {
    return this.queue.map((k) => "v:" + k);
  }
}
const lit: Chain = {
  get(key: string): Chain {
    return lit;
  },
  exec(): string[] {
    return ["lit"];
  },
};
function make(useClass: boolean): Chain {
  return useClass ? new Pipeline() : lit;
}
const a = make(true);
const b = make(false);
a.get("x").get("y");
console.log(a.exec().join(","), b.exec().join(","), a.get("z") === a, b.get("q") === b);
console.log(Object.keys(a).join(","), Object.keys(b).sort().join(","));
console.log(a instanceof Pipeline, b instanceof Pipeline);
