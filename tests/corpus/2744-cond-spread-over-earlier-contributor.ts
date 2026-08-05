// `{ jid, ...opts, ...(t ? { k: t } : {}) }` — a conditional spread over a
// name an EARLIER contributor already wrote (the presence-subscribe node
// builder). JS is last-write-wins, so the empty arm leaves the earlier
// value standing; the desugar's one-entry-per-name list therefore merges
// the two into one present-test whose else branch IS that earlier value,
// instead of the undefined arm. Because the earlier contributor supplies
// the absent case, the target field does not have to be optional here.

interface Opts {
  readonly kind?: string;
  readonly token?: string;
}
interface Node2 {
  readonly jid: string;
  readonly kind?: string;
  readonly token?: string;
}

function build(jid: string, opts: Opts, t: string | null): Node2 {
  return { jid, ...opts, ...(t ? { token: t } : {}) };
}

// The earlier contributor is an EXPLICIT property, and a pure one.
interface Req {
  readonly a: string;
  readonly b: string;
}
function required(t: string | null): Req {
  return { a: "A", b: "B", ...(t ? { b: t } : {}) };
}

// Reversed orientation: the carrier is the FALSE arm.
function reversed(opts: Opts, quiet: boolean): Node2 {
  return { jid: "j", ...opts, ...(quiet ? {} : { kind: "loud" }) };
}

// The conditional spread comes FIRST and a later spread must still fence
// on it — not exercised for output here, only that this file compiles.
function first(t: string | null): Node2 {
  return { ...(t ? { token: t } : {}), jid: "j2" };
}

function show(n: Node2): string {
  return `${n.jid}|${n.kind ?? "-"}|${n.token ?? "-"}`;
}

function main(): void {
  console.log("A", show(build("j1", {}, null)));
  console.log("B", show(build("j1", {}, "t1")));
  console.log("C", show(build("j1", { kind: "k", token: "old" }, null)));
  console.log("D", show(build("j1", { kind: "k", token: "old" }, "new")));
  const r1 = required(null);
  const r2 = required("t2");
  console.log("E", r1.a + r1.b, r2.a + r2.b);
  console.log("F", show(reversed({ kind: "q" }, true)));
  console.log("G", show(reversed({ kind: "q" }, false)));
  console.log("H", show(first(null)), show(first("t3")));
  console.log("I", JSON.stringify(build("j1", { token: "old" }, null)));
  console.log("J", JSON.stringify(build("j1", { token: "old" }, "new")));
}

main();
