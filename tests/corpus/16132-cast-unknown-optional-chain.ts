// An optional chain on an absent object member read through a cast, and the
// same read through the record type, both answer undefined.
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
}
type Doc = { kind: string } & { _id?: ObjectId };
const d: Doc = { kind: 'open' };
const hex = (d as { _id?: ObjectId })._id?.hex;
console.log(hex === undefined ? 'no hex' : hex);
const again = d._id?.hex;
console.log(again === undefined ? 'no hex' : again);
