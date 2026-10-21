// Placeholder initializers (`x: T = null!` / `= undefined!`) and increment /
// compound assignment on a field assigned past the constructor. Node holds
// null/undefined until the assignment; `undefined++` is NaN and
// `undefined += "x"` is "undefinedx".
class Svc { db: string = null!; cfg: { id: number } = undefined!; count: number = undefined!; ok: boolean = null!;
  start() { this.db = "pg"; this.cfg = { id: 1 }; this.count = 3; this.ok = true; } }
function tp(name: string, f: () => void) {
  try { f(); } catch (e) { console.log(name, "threw", e instanceof TypeError ? "TypeError" : "other", (e as Error).message); }
}
const sv = new Svc();
console.log(sv.db, sv.cfg, sv.count, sv.ok, typeof sv.db, typeof sv.count, sv.db === null, sv.cfg === undefined);
tp("len", () => console.log(sv.db.length));
tp("id", () => console.log(sv.cfg.id));
sv.start();
console.log(sv.db, sv.cfg, sv.count, sv.ok, sv.db.length, sv.cfg.id, sv.count + 1);
function localPh() {
  let x: string = null!; let y: number = undefined!;
  console.log(x, y, typeof x, `${x}-${y}`);
  tp("lx", () => console.log(x.length));
  x = "set"; y = 4;
  console.log(x, y, x.length, y + 1);
}
localPh();

class KA { n!: number; s!: string; arr!: number[];
  bump() { this.n++; this.n += 2; this.s += "x"; return [this.n, this.s]; }
  init() { this.n = 5; this.s = "q"; this.arr = []; } }
const ka = new KA(); console.log(ka.bump());
const kb = new KA(); kb.init(); console.log(kb.bump());
class KC { c!: number; dec() { this.c--; --this.c; return this.c; } }
console.log(new KC().dec());
class KD { v!: number; go() { const w = this.v++; return [w, this.v]; } init() { this.v = 1; } }
const kd = new KD(); console.log(kd.go()); kd.init(); console.log(kd.go());
