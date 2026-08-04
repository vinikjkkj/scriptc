// An OPTIONAL method slot on a record, called after the checker proved it
// present. The slot's IR type is `func | undefined`; the guard narrows the
// USE, and the call has to see the narrowed arm. Spelled through a
// temporary (`const f = deps.transform; f(...)`) this always compiled —
// the identifier read bridges the union — so the direct call spelling
// compiling too is the same program, not a new capability.

type Deps = {
  readonly label: string;
  readonly transform?: (input: string, times?: number) => string;
  readonly nextId?: () => string;
  readonly fallbackId: () => string;
};

// if-guard with an early return, and a call that OMITS the optional param.
function shout(deps: Deps): string {
  if (!deps.transform) return deps.label;
  return deps.transform(deps.label);
}

// The same guard, calling with every parameter supplied.
function shoutTwice(deps: Deps): string {
  if (deps.transform === undefined) return deps.label;
  return deps.transform(deps.label, 2);
}

// Ternary guard: the narrowed arm in the true branch, a sibling slot in
// the false one (the zapo `generator.nextSystem ? ... : generator.next()`
// shape).
function idOf(deps: Deps): string {
  return deps.nextId ? deps.nextId() : deps.fallbackId();
}

// The temporary spelling, kept alongside so the two must agree.
function shoutViaTemp(deps: Deps): string {
  const f = deps.transform;
  if (!f) return deps.label;
  return f(deps.label);
}

const repeat = (input: string, times?: number): string => {
  let out = "";
  for (let i = 0; i < (times ?? 1); i++) out += input;
  return out;
};

const full: Deps = {
  label: "ha",
  transform: repeat,
  nextId: () => "generated",
  fallbackId: () => "fallback",
};

const bare: Deps = { label: "ho", fallbackId: () => "fallback" };

console.log(shout(full));
console.log(shout(bare));
console.log(shoutTwice(full));
console.log(shoutTwice(bare));
console.log(idOf(full));
console.log(idOf(bare));
console.log(shoutViaTemp(full));
console.log(shoutViaTemp(bare));

// A method slot reached through a nested record, guarded one level up.
type Outer = { readonly inner: { readonly run?: (n: number) => number } };
const withRun: Outer = { inner: { run: (n) => n * 3 } };
const withoutRun: Outer = { inner: {} };
function runInner(o: Outer): number {
  const r = o.inner;
  if (!r.run) return -1;
  return r.run(7);
}
console.log(runInner(withRun));
console.log(runInner(withoutRun));
