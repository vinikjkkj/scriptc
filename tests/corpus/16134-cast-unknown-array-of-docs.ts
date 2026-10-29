// Each element of an array of documents, cast to unknown: absent members are
// undefined element by element, present members keep their value.
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
}
type Doc = { kind: string } & { _id?: ObjectId };
const docs: Doc[] = [{ kind: 'a' }, { kind: 'b', _id: new ObjectId('c1') }, { kind: 'c' }];
for (const doc of docs) {
  const id = (doc as { _id?: unknown })._id;
  console.log(doc.kind, id === undefined ? 'none' : (id as ObjectId).hex);
}
