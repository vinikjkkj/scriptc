// The divergent getter/setter pair where mongodb actually puts it: on the
// GENERIC abstract base every operation extends.
//
//     abstract class AbstractOperation<TResult> {
//       get session(): ClientSession | undefined { ... }
//       set session(session: ClientSession)      { ... }
//     }
//
// One declaration, one pair, and a separate compiled class per instantiation
// — so the pair's two signatures have to survive substitution six times over
// and stay independent in each. A subclass that inherits the pair unchanged
// still reads and writes it, and a subclass that overrides it does so at the
// instantiated types.
//
// The extra thing pinned here beyond 7740: the pair on a base whose TYPE
// PARAMETER appears nowhere in either half. A model that folded the two
// halves into one property type would have to pick one at substitution time,
// and the read side and the write side would disagree per instantiation
// rather than uniformly — the failure that prints a plausible value.

class Session {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

abstract class Operation<TResult> {
  private _session: Session | undefined = undefined;
  readonly label: string;

  constructor(label: string) {
    this.label = label;
  }

  // The pair. Neither half mentions TResult.
  get session(): Session | undefined {
    return this._session;
  }
  set session(session: Session) {
    this._session = session;
  }

  clearSession(): void {
    this._session = undefined;
  }

  abstract execute(): TResult;

  // A read through the getter from the base's own body, under the type
  // parameter — the call the subclass inherits verbatim.
  trace(): string {
    const s = this.session;
    return this.label + ":" + (s === undefined ? "-" : s.id);
  }
}

class CountOp extends Operation<number> {
  execute(): number {
    return this.session === undefined ? 0 : this.session.id.length;
  }
}

class NamesOp extends Operation<string[]> {
  execute(): string[] {
    const s = this.session;
    return s === undefined ? [] : [s.id, s.id + "!"];
  }
}

class FlagOp extends Operation<boolean> {
  execute(): boolean {
    return this.session !== undefined;
  }
}

// A subclass that OVERRIDES both halves at the instantiated type — the
// halves stay independent under substitution.
class TaggedOp extends Operation<string> {
  get session(): Session | undefined {
    const s = super.session;
    return s === undefined ? undefined : new Session("<" + s.id + ">");
  }
  set session(s: Session) {
    super.session = new Session(s.id.toUpperCase());
  }
  execute(): string {
    const s = this.session;
    return s === undefined ? "none" : s.id;
  }
}

// ------------------------------------------------- before any write at all
const count = new CountOp("count");
const names = new NamesOp("names");
const flag = new FlagOp("flag");
const tagged = new TaggedOp("tagged");

console.log(count.session, names.session, flag.session, tagged.session);
console.log(count.trace(), names.trace(), flag.trace(), tagged.trace());
console.log(count.execute(), names.execute().length, flag.execute(), tagged.execute());

// ------------------------------------------------------ written, then read
count.session = new Session("c1");
names.session = new Session("n1");
flag.session = new Session("f1");
tagged.session = new Session("t1");

console.log(count.trace(), names.trace(), flag.trace(), tagged.trace());
console.log(count.execute(), names.execute().join("|"), flag.execute(), tagged.execute());
console.log(count.session === undefined ? "u" : count.session.id);
console.log(tagged.session === undefined ? "u" : tagged.session.id);

// The base's own writer puts the undefined arm back, and every read agrees.
//
// The last read goes through `peekSession`: tsc keeps `count.session`
// narrowed to `Session` across the `clearSession()` call (its property-
// narrowing unsoundness, unrelated to this pair), and a compiled read that
// trusts that narrowing aborts where Node prints undefined. Unnarrowed
// inside the helper, the two agree.
function peekSession<T>(o: Operation<T>): Session | undefined {
  return o.session;
}
count.clearSession();
tagged.clearSession();
console.log(count.trace(), tagged.trace());
console.log(count.execute(), tagged.execute());
console.log(peekSession(count), peekSession(tagged));

// --------------------------------------------- through a base-typed binding
// Reads and writes through `Operation<number>` and `Operation<string>`
// references: the vtable's get half and set half are separate slots, so a
// subclass that overrides both must be picked up by both.
const asCount: Operation<number> = count;
const asTagged: Operation<string> = tagged;

asCount.session = new Session("via-base-n");
asTagged.session = new Session("via-base-s");
console.log(asCount.trace(), asTagged.trace());
console.log(asCount.session === undefined ? "u" : asCount.session.id);
console.log(asTagged.session === undefined ? "u" : asTagged.session.id);
console.log(asCount.execute(), asTagged.execute());

// -------------------------------------------------------- across a fan-out
// A homogeneous array of one instantiation, written in a loop and read back
// in another — the same pair through an element receiver.
const many: Operation<number>[] = [new CountOp("a"), new CountOp("b"), new CountOp("c")];
for (let i = 0; i < many.length; i++) {
  if (i !== 1) many[i]!.session = new Session("id" + i);
}
for (const each of many) console.log(each.trace(), each.execute());
console.log(many.map((m) => (m.session === undefined ? "-" : m.session.id)).join(","));

// A generic function over the base: one body, two instantiations, and the
// pair read through the type parameter's constraint.
function seal<T>(op: Operation<T>, s: Session): string {
  op.session = s;
  const back = op.session;
  return back === undefined ? "?" : back.id;
}
console.log(seal(new CountOp("g1"), new Session("gen1")));
console.log(seal(new NamesOp("g2"), new Session("gen2")));
console.log(seal(new TaggedOp("g3"), new Session("gen3")));
