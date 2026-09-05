// An override may declare TRAILING OPTIONAL parameters the slot does not
// carry — bson's `toExtendedJSON(options?: EJSONOptions)` over
// `abstract toExtendedJSON(): unknown`. A base-typed call passes none, and
// Node's answer for an omitted optional is `undefined`, so the synthesized
// vtable thunk hands the implementation exactly that. A call at the leaf's
// own type still passes the argument.
abstract class Value {
  abstract render(): unknown;
}

class Num extends Value {
  n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  override render(opts?: { pad?: number; hex?: boolean }): string | number {
    if (opts && opts.hex === true) return '0x' + this.n.toString(16);
    if (opts && opts.pad !== undefined) return String(this.n).padStart(opts.pad, '0');
    return this.n;
  }
}

// TWO extra optional parameters, and a return that needs no widening.
class Word extends Value {
  override render(upper?: boolean, times?: number): string {
    const base = upper === true ? 'W' : 'w';
    return base.repeat(times ?? 1);
  }
}

// No extra parameters at all: its vtable entry is the method itself.
class Nil extends Value {
  override render(): unknown {
    return null;
  }
}

const vs: Value[] = [new Num(255), new Word(), new Nil()];
for (const v of vs) console.log(JSON.stringify(v.render()));

const n = new Num(255);
console.log(JSON.stringify(n.render()));
console.log(JSON.stringify(n.render({})));
console.log(JSON.stringify(n.render({ pad: 5 })));
console.log(JSON.stringify(n.render({ hex: true })));

const w = new Word();
console.log(w.render(), w.render(true), w.render(true, 3), w.render(undefined, 2));

// The thunk runs once per dispatch, not once per program: a loop over the
// same base-typed slot answers the same thing every time.
let acc = '';
for (let k = 0; k < 3; k++) {
  for (const v of vs) acc += String(v.render()) + '|';
}
console.log(acc);

// The OTHER direction: an override that declares FEWER parameters than the
// slot. A JS function ignores arguments past its list, so the thunk simply
// does not forward them — bson's `MinKey.inspect()` over
// `abstract inspect(depth?, options?, inspect?)` is exactly this.
abstract class Shown {
  abstract show(depth?: number, opts?: string): string;
}
class MinShown extends Shown {
  override show(): string {
    return 'min';
  }
}
class HalfShown extends Shown {
  override show(depth?: number): string {
    return 'half:' + String(depth);
  }
}
class FullShown extends Shown {
  override show(depth?: number, opts?: string): string {
    return 'full:' + String(depth) + ':' + String(opts);
  }
}
const shown: Shown[] = [new MinShown(), new HalfShown(), new FullShown()];
for (const s of shown) console.log(s.show());
for (const s of shown) console.log(s.show(2));
for (const s of shown) console.log(s.show(2, 'o'));
console.log(new MinShown().show(), new HalfShown().show(5));

// A VOID slot widens too — there is no value to box, so the thunk's whole
// body is the call.
class Sink {
  write(): void {
    console.log('base');
  }
}
class Tagged extends Sink {
  override write(prefix?: string): void {
    console.log((prefix ?? '-') + 'tag');
  }
}
const sinks: Sink[] = [new Sink(), new Tagged()];
for (const s of sinks) s.write();
new Tagged().write('x');
