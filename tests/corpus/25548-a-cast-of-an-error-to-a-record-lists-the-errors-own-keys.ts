// A cast spelling an Error as a record type does not change which keys the value has: the walk is the error's own (creation order), not the cast's declared fields.
const err = new Error("boom");
console.log(JSON.stringify(Object.keys(err as unknown as { message: string })));
const named = new TypeError("t");
named.name = "Renamed";
console.log(JSON.stringify(Object.keys(named as unknown as { message: string; name: string })));
class Tagged extends Error {
  public tag = "t";
  public constructor(m: string) { super(m); this.name = "Tagged"; }
}
const tagged = new Tagged("x");
console.log(JSON.stringify(Object.keys(tagged as unknown as { message: string })));
