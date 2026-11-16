// A class extending Error routes its own `code` onto the runtime slot, so its layout is not a plain base prefix plus own fields: the number-slot pass
// must leave it alone, and still split a numeric field of an ordinary class declared next to it.
class StoreError extends Error {
  code: string;
  where: any;
  constructor(message: string, src: any) {
    super(message);
    this.code = "E_STORE";
    this.where = src.at;
  }
  describe(): any {
    return this.where + 1;
  }
}
class Plain {
  pos: any;
  constructor(src: any) {
    this.pos = src.at;
  }
  next(): any {
    return this.pos + 1;
  }
}

function asAny(x: any): any {
  return x;
}
const e = new StoreError("boom", { at: 70000 });
const p = new Plain({ at: 70000 });
console.log(e.message, e.code, e.where, e.describe(), asAny(e).where, e instanceof Error);
console.log(p.pos, p.next(), asAny(p).pos, JSON.stringify(asAny(p)));
try {
  throw new StoreError("again", { at: "x" });
} catch (err) {
  const x = asAny(err);
  console.log(x.message, x.code, x.where, x.describe());
}
