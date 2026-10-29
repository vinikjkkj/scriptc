// mongodb shape: `Collection<TSchema = Document>` with an insertOne whose
// parameter is OptionalUnlessRequiredId<TSchema>. At Document (an index
// signature, no _id) the checker resolves the parameter to
// Document & { _id?: ... }, so the insert takes an object with or without _id.
export {};
interface Document {
  [key: string]: any;
}
type EnhancedOmit<T, K> = string extends keyof T
  ? T
  : T extends any
    ? Pick<T, Exclude<keyof T, K>>
    : never;
type InferIdType<T> = T extends { _id: infer I }
  ? I
  : T extends { _id?: infer I }
    ? unknown extends I
      ? string
      : I
    : never;
type OptionalId<T> = EnhancedOmit<T, '_id'> & { _id?: InferIdType<T> };
type OptionalUnlessRequiredId<T> = T extends { _id: any } ? T : OptionalId<T>;

class Collection<TSchema = Document> {
  readonly stored: string[] = [];
  private seq = 0;
  async insertOne(doc: OptionalUnlessRequiredId<TSchema>): Promise<{ insertedId: string }> {
    const id = (doc as Document)['_id'] !== undefined ? String((doc as Document)['_id']) : 'auto' + this.seq++;
    this.stored.push(id);
    return { insertedId: id };
  }
}

export async function main(): Promise<void> {
  const c = new Collection();
  const a = await c.insertOne({ name: 'ada', n: 1 });
  const b = await c.insertOne({ _id: 'k-7', name: 'grace', n: 2 });
  const d = await c.insertOne({ name: 'linus', tags: ['x', 'y'] });
  console.log(a.insertedId, b.insertedId, d.insertedId);
  console.log(c.stored.join(','));
}
main();
