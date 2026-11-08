// A class instance that a method hands out as an INTERFACE it structurally satisfies stays the instance: the chained calls resolve through the class and
// the same object comes back out of each one.
interface Chain {
  get(key: string): Chain;
  exec(): string[];
}
class Pipeline {
  queue: string[] = [];
  get(key: string): Pipeline {
    this.queue.push(key);
    return this;
  }
  exec(): string[] {
    return this.queue.map((k) => "v:" + k);
  }
}
class Redis {
  pipeline(): Chain {
    return new Pipeline();
  }
}
const p = new Redis().pipeline();
p.get("a").get("b");
console.log(p.exec().join(","));
const again = new Redis().pipeline();
console.log(again.get("q") === again, again.exec().length);
