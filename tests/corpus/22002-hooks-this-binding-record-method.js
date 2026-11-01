// `this` inside a hook is the hooks record, through an optional call.
class Pool {
  constructor(hooks) { this.hooks = hooks; }
  go(r) { this.hooks.onCreate?.(r); this.hooks.onRemove?.(r); }
}
const hooks = {
  tag: "T",
  onCreate(r) { console.log("create", this.tag, r); },
};
const p = new Pool(hooks);
p.go(3);
p.hooks.tag = "U";
p.go(4);
