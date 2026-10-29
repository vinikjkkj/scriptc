// mongodb shape at a TYPED schema: OptionalUnlessRequiredId<Event> without an
// _id member resolves to the EnhancedOmit'd Event plus an optional _id (typed
// by InferIdType's ObjectId fallback); with an _id member (Ticket) it resolves
// to the schema itself.
export {};
class ObjectId {
  hex: string;
  constructor(hex: string) {
    this.hex = hex;
  }
  toHexString(): string {
    return this.hex;
  }
}
interface Event {
  kind: string;
  at: number;
}
interface Ticket {
  _id: string;
  seat: number;
}
type EnhancedOmit<T, K> = string extends keyof T
  ? T
  : T extends any
    ? Pick<T, Exclude<keyof T, K>>
    : never;
type InferIdType<TSchema> = TSchema extends { _id: infer IdType }
  ? Record<any, never> extends IdType
    ? never
    : IdType
  : TSchema extends { _id?: infer IdType }
    ? unknown extends IdType
      ? ObjectId
      : IdType
    : ObjectId;
type OptionalId<T> = EnhancedOmit<T, '_id'> & { _id?: InferIdType<T> };
type OptionalUnlessRequiredId<T> = T extends { _id: any } ? T : OptionalId<T>;

class Collection<TSchema> {
  inserted = 0;
  async insertOne(doc: OptionalUnlessRequiredId<TSchema>): Promise<void> {
    if (doc !== undefined) this.inserted++;
  }
}

export async function main(): Promise<void> {
  const ev = new Collection<Event>();
  await ev.insertOne({ kind: 'open', at: 10 });
  await ev.insertOne({ kind: 'close', at: 20 });
  const tk = new Collection<Ticket>();
  await tk.insertOne({ _id: 't1', seat: 4 });
  console.log(ev.inserted, tk.inserted);
}
main();
