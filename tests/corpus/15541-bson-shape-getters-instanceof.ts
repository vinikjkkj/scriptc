// Real bson shape: abstract base with a symbol-keyed version getter and an
// abstract _bsontype getter; subclasses override _bsontype; checks through the
// subclass, instanceof, String(x), and console.log of the instance.
export abstract class BaseValue {
  public abstract get _bsontype(): "Binary" | "Code";
  get [Symbol.for("@@mdb.bson.version")](): number {
    return 7;
  }
  public abstract toExtendedJSON(): unknown;
  describe(): string {
    return "tag=" + this._bsontype;
  }
  toString(): string {
    return "BaseValue(" + this._bsontype + ")";
  }
}

export class Binary extends BaseValue {
  readonly buffer: string;
  constructor(buffer: string) {
    super();
    this.buffer = buffer;
  }
  get _bsontype(): "Binary" {
    return "Binary";
  }
  toExtendedJSON(): unknown {
    return { $binary: this.buffer };
  }
}

export class Code extends BaseValue {
  readonly code: string;
  constructor(code: string) {
    super();
    this.code = code;
  }
  get _bsontype(): "Code" {
    return "Code";
  }
  toExtendedJSON(): unknown {
    return { $code: this.code };
  }
}

const b = new Binary("abc");
const c = new Code("x=1");
console.log(b._bsontype, c._bsontype, b.describe(), c.describe());
console.log(b instanceof Binary, b instanceof BaseValue, b instanceof Code);
console.log(c instanceof Code, c instanceof BaseValue, c instanceof Binary);
console.log(String(b), String(c), "" + b);
console.log(b);
console.log(c);
console.log(JSON.stringify(b.toExtendedJSON()), JSON.stringify(c.toExtendedJSON()));
