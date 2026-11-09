// A class instance flowing into an interface-typed record is the same object seen through the record: writes in both directions are
// visible, methods run on the instance, and two projections of one instance are one record.
interface R { n: number; name: string; exec(): number; getName(): string; }
class K {
  n = 9;
  name = "kk";
  exec(): number { return this.n + 1; }
  getName(): string { return this.name + "!"; }
}
class Sub extends K {
  extra = 5;
  exec(): number { return this.n * 2 + this.extra; }
}
function mkk(): K { return new K(); }
function mksub(): K { return new Sub(); }

const viaCast = (mkk as unknown as () => R)();
console.log(viaCast.exec(), viaCast.getName());
viaCast.n = 100;
console.log(viaCast.exec(), viaCast.n);

const factory: () => R = mkk;
const viaSlot = factory();
viaSlot.n = 7;
console.log(viaSlot.exec(), viaSlot.n);

const k = new K();
const r: R = k;
console.log(r.exec(), r === (k as R));
k.n = 50;
console.log(r.n, r.exec());
r.name = "zz";
console.log(k.name, k.getName(), r.getName());

const s = new Sub();
const rs: R = s;
console.log(rs.exec(), rs.getName());
s.n = 3;
rs.name = "sub";
console.log(rs.n, rs.exec(), s.getName());
const subAsBase: K = new Sub();
const rb: R = subAsBase;
rb.n = 4;
console.log(rb.exec(), subAsBase.n);

const list: K[] = [new K(), new Sub(), new K()];
list[2]!.n = 20;
const rs3: R[] = list;
rs3[0]!.n = 1;
console.log(rs3.map((x) => x.exec()).join(","), list[0]!.n);
list[1]!.n = 6;
console.log(rs3.map((x) => x.exec()).join(","), rs3[1]!.n);

const plain: R = { n: 1, name: "lit", exec() { return 11; }, getName() { return "lit!"; } };
const mixed: R[] = [plain, r, rs];
console.log(mixed.map((x) => x.getName()).join("|"), mixed.map((x) => x.n).join(","));

// A method that mutates the instance: the record's data member must follow it.
interface Counter { n: number; label: string; inc(): void; }
class Tick {
  n = 0;
  label = "t";
  inc(): void { this.n++; this.label = this.label + "+"; }
}
const tick = new Tick();
const rc: Counter = tick;
rc.inc();
rc.inc();
console.log(rc.n, tick.n, rc.label, tick.label);
tick.inc();
console.log(rc.n, rc.label);
