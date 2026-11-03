// pg's `poolFactory = (Client) => class BoundPool extends Pool`: the class
// extends a program class and closes over the factory argument; the
// constructor calls super with merged options.
class Pool {
  options: { max: number; name: string };
  clientName: string;
  constructor(options: { max?: number; name?: string }, clientName?: string) {
    this.options = { max: options.max ?? 10, name: options.name ?? "pool" };
    this.clientName = clientName ?? "none";
  }
  describe(): string {
    return this.options.name + "/" + this.options.max + "/" + this.clientName;
  }
}
class ClientA {
  id = "A";
}
class ClientB extends ClientA {
  constructor() {
    super();
    this.id = "B";
  }
}
const poolFactory = (Client: typeof ClientA) => {
  return class BoundPool extends Pool {
    constructor(options: { max?: number; name?: string }) {
      super({ ...options, max: (options.max ?? 1) * 2 }, new Client().id);
    }
    extra(): string {
      return "bound:" + new Client().id + ":" + this.describe();
    }
  };
};
const P1 = poolFactory(ClientA);
const P2 = poolFactory(ClientB);
const p1 = new P1({ name: "one", max: 3 });
const p2 = new P2({ name: "two" });
console.log(p1.extra());
console.log(p2.extra());
console.log(p1 instanceof Pool, p1 instanceof P1, p1 instanceof P2, p2 instanceof P2, p2 instanceof P1);
console.log(P1 === P2, P1.name, P2.name);
const pools: Pool[] = [p1, p2, new Pool({})];
for (const q of pools) console.log(q instanceof P1, q instanceof P2, q instanceof Pool);
console.log(p1);
console.log(P1);
console.log([P1, P2]);
