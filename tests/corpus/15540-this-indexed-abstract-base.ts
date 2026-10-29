// An abstract base whose symbol-keyed getter is annotated with a polymorphic
// `this` indexed type. The annotation used to reject the whole base class, so
// every subclass refused "extending classes not declared in the program".
export const bsonType = Symbol.for("@@mdb.bson.type");
export const versionSym = Symbol.for("@@mdb.bson.version");

export type TagName = "Binary" | "Code" | "Double";

export abstract class BaseValue {
  public abstract get _bsontype(): TagName;

  public get [bsonType](): this["_bsontype"] {
    return this._bsontype;
  }

  get [versionSym](): number {
    return 7;
  }

  public abstract inspect(depth?: number): string;

  abstract toExtendedJSON(): unknown;

  describe(): string {
    return "tag=" + this._bsontype;
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
  inspect(depth?: number): string {
    return "Binary(" + this.buffer + ", " + (depth ?? 0) + ")";
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
  inspect(): string {
    return "Code(" + this.code + ")";
  }
  toExtendedJSON(): unknown {
    return { $code: this.code };
  }
}

const values: BaseValue[] = [new Binary("abc"), new Code("x=1"), new Binary("")];
for (const v of values) {
  console.log(v._bsontype, v.describe());
  console.log(v instanceof BaseValue, v instanceof Binary, v instanceof Code);
  console.log(v.inspect(2), JSON.stringify(v.toExtendedJSON()));
}
console.log(Object.keys(values[0]!).join(","), typeof values[1]!.describe());
