// An override may declare a parameter of a wider record type than the method it overrides (TypeScript accepts it, mongodb's
// MongoDBResponse#toObject does): a call through the base type reaches the override with the argument converted to it.
interface BaseOptions {
  depth?: number;
}
interface WideOptions extends BaseOptions {
  validation?: string;
}
class Doc {
  toObject(options?: WideOptions): string {
    return "doc:" + (options?.depth ?? -1) + ":" + (options?.validation ?? "-");
  }
}
class Resp extends Doc {
  override toObject(options?: BaseOptions): string {
    return "resp:" + (options?.depth ?? -1);
  }
}
const viaBase: Doc = new Resp();
console.log(viaBase.toObject({ depth: 1, validation: "x" }));
console.log(new Resp().toObject({ depth: 2 }));
console.log(new Doc().toObject({ validation: "v" }));
const all: Doc[] = [new Doc(), new Resp()];
for (const d of all) console.log(d.toObject({ depth: 3, validation: "y" }));
