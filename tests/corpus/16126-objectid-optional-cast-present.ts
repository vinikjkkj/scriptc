// The same cast with the member present: the value comes through as an unknown.
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
  const d: Doc = { kind: 'open', _id: new ObjectId('ab') };
  const id = (d as { _id?: unknown })._id;
  console.log(id === undefined ? 'none' : 'some', (id as ObjectId).hex);
}
main();
