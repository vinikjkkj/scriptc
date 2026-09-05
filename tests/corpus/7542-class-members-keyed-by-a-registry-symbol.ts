// Class members keyed by a GLOBAL REGISTRY symbol. bson hangs two of them
// on the abstract base of its whole value hierarchy — a
// `get [BSON_VERSION_SYMBOL]()` and a
// `[Symbol.for('nodejs.util.inspect.custom')]()` — and the two names alone
// used to refuse the base and every class under it.
//
// The slots are DECLARED ONLY: nothing dispatches to them (an `x[S]`
// access keeps its symbol fence), so what this program checks is that
// declaring them costs the class nothing.
const VERSION_KEY = Symbol.for('@@corpus.version');
// A SECOND const for the SAME registry key. Symbol.for hands both the one
// runtime symbol, so both must name the one slot — which is why the slot
// is keyed by the registry string and not by the const's identity. (Two
// members keyed this way in ONE class is the fence; two consts is not.)
const ALSO_VERSION_KEY = Symbol.for('@@corpus.version');

abstract class Value {
  abstract get kind(): string;

  get [VERSION_KEY](): number {
    return 2;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '<' + this.kind + '>';
  }

  abstract render(): string;
}

class Num extends Value {
  v: number;
  constructor(v: number) {
    super();
    this.v = v;
  }
  override get kind(): string {
    return 'num';
  }
  override render(): string {
    return this.kind + '(' + this.v + ')';
  }
}

class Text extends Value {
  v: string;
  constructor(v: string) {
    super();
    this.v = v;
  }
  override get kind(): string {
    return 'text';
  }
  get [ALSO_VERSION_KEY](): number {
    return 3;
  }
  override render(): string {
    return this.kind + '(' + this.v + ')';
  }
}

const vs: Value[] = [new Num(7), new Text('hi')];
for (const v of vs) console.log(v.kind, v.render());

function show(v: Value): string {
  return v.render().toUpperCase();
}
console.log(show(vs[0]!), show(vs[1]!));
console.log(typeof VERSION_KEY, typeof ALSO_VERSION_KEY);
