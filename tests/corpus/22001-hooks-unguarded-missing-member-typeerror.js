// An unguarded call of a missing function-valued member: Node's exact TypeError.
class Pool {
  constructor(hooks) { this.hooks = hooks; }
  remove(r) { this.hooks.onRemove(r); }
}
const p = new Pool({ onCreate: () => 1 });
try {
  p.remove(7);
  console.log("no throw");
} catch (e) {
  console.log(e instanceof TypeError, e.message);
}
