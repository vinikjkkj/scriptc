// Collection<{ _id: number }> through the same alias: the required-_id arm keeps
// the schema itself, so the insert demands the _id.
export {};
type OptionalUnlessRequiredId<T> = T extends { _id: any } ? T : { _id?: number } & T;
class Collection<TSchema> {
  readonly seen: number[] = [];
  async insertOne(doc: OptionalUnlessRequiredId<TSchema>): Promise<void> {
    this.seen.push((doc as { _id: number })._id);
  }
}
export async function main(): Promise<void> {
  const c = new Collection<{ _id: number; label: string }>();
  await c.insertOne({ _id: 41, label: 'a' });
  await c.insertOne({ _id: 42, label: 'b' });
  console.log(c.seen.join(','));
}
main();
