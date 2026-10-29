// A covariant return through stream-rooted classes: the base-typed call gets a Readable subclass instance back through the vtable and reads base and subclass members.
import { Readable } from "node:stream";
class BaseR extends Readable {
  impl: number;
  constructor(impl: number) { super(); this.impl = impl; }
  kind(): string { return 'br:' + this.impl; }
}
class SubR extends BaseR {
  tag: string;
  constructor(impl: number) { super(impl); this.tag = 'sub'; }
  extra(): string { return 'sr:' + this.impl + ':' + this.tag; }
}
class Maker {
  make(impl: number): BaseR { return new BaseR(impl); }
}
class SubMaker extends Maker {
  make(impl: number): SubR { return new SubR(impl); }
}
function viaMaker(m: Maker): string {
  const r = m.make(3);
  return r.kind() + '|' + String(r instanceof SubR) + '|' + r.constructor.name;
}
console.log(viaMaker(new Maker()));
console.log(viaMaker(new SubMaker()));
