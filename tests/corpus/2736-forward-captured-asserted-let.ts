// `let x!: T` captured by closures written ABOVE its declaration — the
// hoisted-handler shape written the other way round, because the binding's
// value needs the things declared in between:
//
//   const coord = make({ publish: (n) => dispatch.publish(n) })
//   let dispatch!: Dispatch
//   dispatch = new Dispatch({ coord })
//
// The binding hoists to scope entry exactly as a const does, so it takes
// the same TDZ box: reads while the box is empty throw Node's catchable
// ReferenceError, and the box is what every capture shares. The `let` half
// adds two things a const never needed — the box is MUTABLE, so a second
// assignment is seen by the captures and by direct reads alike, and the
// declaration itself writes NOTHING (it has no initializer), so the dead
// zone ends at the assignment below it rather than at the declaration.
//
// What this pins against Node: the dead-zone ReferenceError and its exact
// message, the value after the first assignment through a capture and
// directly, reassignment seen from both sides, a second such binding in
// the same scope, and the pair of them capturing each other.
class Dispatch {
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  publish(n: number): string {
    return `${this.tag}#${n}`;
  }
}

class Registry {
  readonly names: string[] = [];
  add(n: string): number {
    this.names.push(n);
    return this.names.length;
  }
}

function makeCoordinator(deps: {
  publish: (n: number) => string;
  tag: () => string;
  register: (n: string) => number;
}): { run: (n: number) => string; who: () => string; enroll: (n: string) => number } {
  return { run: (n) => deps.publish(n), who: () => deps.tag(), enroll: (n) => deps.register(n) };
}

function build(): string[] {
  const out: string[] = [];

  // Written above BOTH declarations and capturing both.
  const coord = makeCoordinator({
    publish: (n) => dispatch.publish(n),
    tag: () => dispatch.tag,
    register: (n) => registry.add(n),
  });

  // The true dead zone: the bindings exist but hold nothing yet.
  try {
    coord.who();
    out.push("dead:no-throw");
  } catch (e) {
    out.push(`dead:${(e as Error).name}:${(e as Error).message}`);
  }
  try {
    coord.enroll("early");
    out.push("dead2:no-throw");
  } catch (e) {
    out.push(`dead2:${(e as Error).name}`);
  }

  let dispatch!: Dispatch;
  let registry!: Registry;

  dispatch = new Dispatch("first");
  registry = new Registry();

  out.push(coord.run(1));
  out.push(coord.who());
  out.push(`enroll=${coord.enroll("a")}`);

  // A `let` may be written again: the capture and the direct read share
  // one binding, so both see the new value.
  dispatch = new Dispatch("second");
  out.push(coord.run(2));
  out.push(dispatch.publish(3));
  out.push(`enroll=${coord.enroll("b")}`);
  out.push(`names=${registry.names.join(",")}`);
  return out;
}

// The same shape twice over, to prove the box is per binding and per call.
function twice(): string {
  const first = build();
  const second = build();
  return `${first.join("|")}\n${second.join("|")}`;
}

console.log(twice());
