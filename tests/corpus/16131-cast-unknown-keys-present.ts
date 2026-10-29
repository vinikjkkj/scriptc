// The cast record printed and serialized with the optional member PRESENT: the
// own key, its JSON value and the key list all come from the value.
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
}
type Doc = { kind: string } & { _id?: ObjectId };
const d: Doc = { kind: 'open', _id: new ObjectId('aa') };
const view = d as { kind: string; _id?: unknown };
console.log(JSON.stringify(view), Object.keys(view), '_id' in view);
console.log(view._id === undefined, view.kind);
