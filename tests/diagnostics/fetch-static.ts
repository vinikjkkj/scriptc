// USER-code `fetch` COMPILES in a static build now (scr_fetch_static.c),
// and so do Response and Headers. What is left here is the surface around
// it that still has no static story, each fencing at its own site and
// naming itself: the AbortSignal STATICS (timeout/abort/any are minted by
// the engine's own AbortSignal — the instance surface lowers, the statics
// do not) and `Response.body`, a ReadableStream this build has no
// representation for. Answering `null` for a response that HAS a body
// would be a wrong VALUE rather than a missing feature, which is why the
// member refuses by name instead.
//
// Never an ICE, never a link error, and never a silent answer.
//
// Written against the SHIPPED fallback lib (this directory has no
// @types/node), so every entry below is a LOWERING fence and not a
// type-checker complaint: a spelling the fallback's own Response or
// RequestInit declaration does not carry would fail preflight and MASK
// the fences this file exists to pin. The member-level fences the wider
// @types/node surface reaches (redirect, the Headers constructor) live in
// tests/harness/fetch-slice-price.test.ts, which compiles both ways.
async function probe(url: string): Promise<number> {
  const r = await fetch(url);
  return r.status;
}
function inspect(r: Response): boolean {
  return r.ok;
}
const sig = AbortSignal.timeout(100);
async function timed(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(100) });
  return r.text();
}
async function streamed(url: string): Promise<boolean> {
  const r = await fetch(url);
  return r.body !== null;
}
probe("http://localhost/a");
timed("http://localhost/b");
streamed("http://localhost/c");
console.log(inspect, sig);
