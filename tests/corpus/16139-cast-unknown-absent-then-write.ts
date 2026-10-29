// The cast member is absent, the record is then written through its own type,
// and the cast reads the new value.
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
}
type Doc = { kind: string } & { _id?: ObjectId };
const d: Doc = { kind: 'open' };
console.log((d as { _id?: unknown })._id === undefined);
d._id = new ObjectId('ff');
console.log(((d as { _id?: unknown })._id as ObjectId).hex);
