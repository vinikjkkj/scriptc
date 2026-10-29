// The mgcondtype shape: an optional object-typed member read through a cast to
// `{ _id?: unknown }` with the key absent. Node answers the absent branch.
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
}
interface Event {
  kind: string;
}
type Doc = Event & { _id?: ObjectId };
export function main(): void {
  const d: Doc = { kind: 'open' };
  const id = (d as { _id?: unknown })._id;
  console.log(id === undefined ? 'none' : 'some', d.kind);
  console.log(id);
}
main();
