// Class values held in an `any`-alias record field: constructed through the field, statics read, extended, compared, stored back and re-read from a second record.
type Ctor = any;
class Base { static tag = "base"; v: number; constructor(v: number) { this.v = v; } get dbl(): number { return this.v * 2; } static make(v: number): Base { return new Base(v); } }
class Kid extends Base { static tag = "kid"; kid = true; }
interface Reg { readonly ctor: Ctor; readonly label: string }
const regs: Reg[] = [{ ctor: Base, label: "b" }, { ctor: Kid, label: "k" }];
for (const r of regs) {
  const inst = new r.ctor(4);
  console.log(r.label, r.ctor.tag, inst.dbl, inst instanceof Base, inst instanceof Kid, r.ctor.make(5).v, r.ctor.name);
}
const other: Reg = { ctor: regs[1]!.ctor, label: "again" };
console.log(other.ctor === Kid, other.ctor === Base, new other.ctor(1));
console.log(JSON.stringify(regs.map((r) => r.label)));
