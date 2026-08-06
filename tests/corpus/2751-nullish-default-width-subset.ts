// `??` whose DEFAULT is an object literal naming a SUBSET of the left's
// single non-unit arm. tsc types `a ?? b` as `NonNullable<typeof a> |
// typeof b`, and the literal keeps its own FRESH type there even though
// the only slot it was ever written for is the arm — so the result type
// spells a union of two records where the value has one representation.
// Building the default AT the arm is the same literal completion an
// annotated slot performs, and the default stays LAZY (the retag helper
// pre-evaluates, so it could never take an effectful one).
interface WebInfo {
  readonly refToken?: string | null;
  readonly version?: string | null;
  readonly webSubPlatform?: number | null;
  readonly browser?: string | null;
}

interface Config {
  readonly webInfo?: WebInfo | null;
}

let defaults = 0;
function defaultSubPlatform(): number {
  defaults++;
  return 4;
}

function pickWebInfo(config: Config): WebInfo {
  return config.webInfo ?? { webSubPlatform: defaultSubPlatform() };
}

// Left present: the arm's own payload comes through and the default must
// NOT be evaluated.
const supplied = pickWebInfo({ webInfo: { refToken: "tok", webSubPlatform: 2 } });
console.log(supplied.refToken ?? "none", supplied.webSubPlatform ?? -1, supplied.browser ?? "none");
console.log("defaults after supplied:", defaults);

// Left undefined and left null both take the default, once each.
const fromUndefined = pickWebInfo({});
console.log(fromUndefined.refToken ?? "none", fromUndefined.webSubPlatform ?? -1);
const fromNull = pickWebInfo({ webInfo: null });
console.log(fromNull.version ?? "none", fromNull.webSubPlatform ?? -1);
console.log("defaults after both:", defaults);

// An omitted field of the completed default reads undefined, exactly as a
// missing property does in Node.
console.log(fromUndefined.browser === undefined, fromUndefined.version === undefined);
console.log(JSON.stringify(fromUndefined));

// The same rule one level down: the `??` sits in a nested record field.
interface Outer {
  readonly inner?: WebInfo;
  readonly tag: string;
}
function pickOuter(o: Outer): Outer {
  return { inner: o.inner ?? { browser: "chrome" }, tag: o.tag };
}
const o1 = pickOuter({ tag: "a" });
console.log(o1.tag, o1.inner?.browser ?? "none", o1.inner?.version ?? "none");
const o2 = pickOuter({ tag: "b", inner: { version: "1", browser: "firefox" } });
console.log(o2.tag, o2.inner?.browser ?? "none", o2.inner?.version ?? "none");

// A default that is the WHOLE arm still lowers the narrowed way it always
// did (no change), and a scalar left keeps the plain shape.
function whole(c: Config): WebInfo {
  return c.webInfo ?? { refToken: null, version: null, webSubPlatform: null, browser: null };
}
console.log(JSON.stringify(whole({})));

function scalar(n: number | undefined): number {
  return n ?? 9;
}
console.log(scalar(3), scalar(undefined));
console.log("defaults total:", defaults);
