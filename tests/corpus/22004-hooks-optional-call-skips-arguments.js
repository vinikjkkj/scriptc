// A nullish callee short-circuits the optional call: the arguments never run.
let evaluated = 0;
function side() { evaluated++; return "x"; }
class Pool {
  constructor(hooks) { this.hooks = hooks; }
  go() { return this.hooks.onRemove?.(side()); }
}
const p = new Pool({ onCreate: () => 1 });
console.log(p.go(), evaluated);
const q = new Pool({ onRemove: (v) => "removed " + v });
console.log(q.go(), evaluated);
