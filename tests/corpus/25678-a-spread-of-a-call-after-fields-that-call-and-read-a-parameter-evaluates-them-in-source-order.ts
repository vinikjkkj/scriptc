// The fields before a spread's call result are evaluated in source order, then the call: a field that is itself a call (it logs), a field reading a reassigned parameter and
// a narrowed const all land before the spread's call in the trace, and each is evaluated exactly once.
const trace: string[] = [];
function tick(s: string, v: number): number { trace.push(s); return v; }
interface Out { a: number; b: number; c: string; d: string; e?: string }
function pick(i: number): string | null { return i % 2 === 0 ? "even" + i : null; }
function tail(tag: string): { d: string; e?: string } {
  trace.push("tail " + tag);
  return tag === "x" ? { d: "dx", e: "ex" } : { d: "d" + tag };
}
function build(p: number, tag: string): Out {
  p += 1;
  const word = pick(p + 1);
  if (word === null) return { a: -1, b: -1, c: "none", d: "-" };
  return { a: tick("a" + p, p), b: p + tick("b", 1), c: word, ...tail(tag) };
}
console.log(JSON.stringify(build(1, "x")));
console.log(JSON.stringify(build(2, "y")));
console.log(JSON.stringify(build(0, "x")));
console.log(trace.join(","));
