// A class value newly crossing into dyn inside a record must be constructible through dyn: an abstract class has no `%dynNew`,
// so the record keeps the compile-time refusal (the bare declared value predates this rule).
abstract class AB { abstract m(): number; static s = 1; }
interface Holder { D?: typeof AB }
const h2: Holder = { D: undefined };
const g: unknown = h2;
console.log(typeof (g as any).D);
