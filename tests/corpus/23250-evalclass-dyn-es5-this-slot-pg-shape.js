// pg's lib/index.js shape: an evaluated class (poolFactory = (Client) => class BoundPool extends Pool)
// stored into an ES5 constructor's this.X, so the class value lives in a dyn slot.
// typeof, name, statics, new, instanceof, identity and inspect all behave as in Node.
// pg-shaped: an evaluated class stored into an ES5 constructor's this.X
class Pool { constructor(options, Client) { this.options = options; this.Client = Client; } }
class Client { constructor(c) { this.c = c; } }
const poolFactory = (Client) => {
  return class BoundPool extends Pool {
    constructor(options) { super(options, Client); }
    static kind() { return "bound"; }
  };
};
const PG = function (clientConstructor) {
  this.Client = clientConstructor;
  this.Pool = poolFactory(this.Client);
};
const pg = new PG(Client);
const P = pg.Pool;
console.log(typeof P, P.name, P.kind());
const p = new P({ a: 1 });
console.log(p.options, p.Client === Client, p instanceof P, p instanceof Pool);
console.log(P === pg.Pool, P === new PG(Client).Pool);
console.log(P);
try { P({}); } catch (e) { console.log(e.name + ": " + e.message); }
