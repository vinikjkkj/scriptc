// A mapped type that resolves to NO members, fully instantiated.
//
// A computed shape with no members is refused, and for a good reason:
// inside a generic BODY, `Partial<T>` has no members because `keyof T` is
// not known there, and interning `{}` would be silently wrong.
//
// That reason does not apply once every type argument is concrete. A
// mapped type over a key set that is genuinely empty has an answer -- no
// members -- and refusing it fails whatever it sits in. In an intersection
// it takes the whole intersection with it, and from there the union arm,
// the field holding the union, and the collection of the class holding
// the field: one empty row in a lookup table can cost a whole class.
type Parts = {
  Named: readonly ["chatJid"];
  Anon: readonly [];
};

type ArgsFor<K extends keyof Parts> = {
  readonly [P in Parts[K][number]]: string;
};

// Named has one index part; Anon has none, so ArgsFor<"Anon"> is empty.
type Row<K extends keyof Parts> = { readonly key: K } & ArgsFor<K>;

const named: Row<"Named"> = { key: "Named", chatJid: "a@s" };
const anon: Row<"Anon"> = { key: "Anon" };
console.log(named.key, named.chatJid, anon.key);

// The union of both rows -- the shape that made the empty one matter.
type AnyRow = Row<"Named"> | Row<"Anon">;
const rows: AnyRow[] = [named, anon];
console.log(rows.length, rows[0].key, rows[1].key);

// And the union crossing a function boundary, which is where the refusal
// used to surface: a field typed `(r: AnyRow) => void` failed to map, so
// the class holding it never collected.
class Sink {
  private readonly seen: string[] = [];
  accept(r: AnyRow): void {
    this.seen.push(r.key);
  }
  report(): string {
    return this.seen.join(",");
  }
}
const sink = new Sink();
for (const r of rows) sink.accept(r);
console.log(sink.report());
