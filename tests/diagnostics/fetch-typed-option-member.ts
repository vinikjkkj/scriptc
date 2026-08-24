// An options record with a `fetch?: typeof fetch` member -- the
// inject-your-own-fetch idiom -- and the ONE statement in that idiom that
// still refuses.
//
// WHAT THIS FILE USED TO PIN, AND WHY IT HAS CHANGED TWICE. The record
// itself refused, zapo reported it at `transport/wa-version-fetcher.ts:211`
// as "values of type 'WaFetchLatestMobileVersionOptions' have no static
// representation", and a census read that type name and recorded the cause
// as "an interface with a RegExp field". It was neither the interface nor
// the RegExp: asked through SCRIPTC_DYN_WHY the chain was four frames deep
// and ended at `RequestInit` in this lane and at `Request` under real
// @types/node. That correction is what the file existed for, and both
// types map now, so the record COMPILES.
//
// The second change is this one. What the file then pinned was the
// SURVIVING statement of the same idiom: an undici `dispatcher` written
// onto the init through an assertion, refused because there was no way to
// drive undici's handler protocol from a compiled program. That is
// implemented (scr_fetch_dispatch.c), so `fetchThrough` below compiles too
// -- and its absence of any diagnostic is now half the assertion.
//
// WHAT STILL REFUSES, and it is the half that keeps this file honest: a
// dispatcher whose TYPE does not prove a callable `dispatch`. The proof is
// not a formality. `opts` and the handler are checked-dynamic objects the
// runtime builds, and the C signature the program's `dispatch` is called
// through is chosen from its declared shape; a closure called through the
// wrong signature is undefined behaviour rather than a diagnosable
// failure, and a value typed `unknown` carries no proof it has a
// `dispatch` at all. Delegating through a guess is the one thing worse
// than refusing, so `viaUnknown` below keeps the SC2020 -- with a hint
// that names the two signatures that WOULD be accepted.
//
// The `PatternOnly` half stays: the RegExp field the census blamed was
// never a blocker, and its absence from this snapshot still says so.

interface VersionOptions {
  readonly url?: string;
  readonly versionPattern?: RegExp;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export function describeOptions(options: VersionOptions = {}): string {
  const pattern = options.versionPattern ?? /\b(2(?:\.\d{1,4}){3})\b/;
  return pattern.source + "|" + (options.url ?? "") + "|" + String(options.timeoutMs ?? 0);
}

console.log(describeOptions());

// zapo's own shape, and it COMPILES: `dispatcher` is narrowed to a
// non-nullable record whose `dispatch` takes two `unknown` parameters,
// which is one of the two signatures this build can call. The narrowing
// matters -- an `undefined` dispatcher dials direct in Node and every
// other falsy value rejects there, so the arm is chosen by type rather
// than by truthiness.
declare const dispatcher: { dispatch: (a: unknown, b: unknown) => unknown } | undefined;

export async function fetchThrough(url: string, options: VersionOptions): Promise<number> {
  const impl = options.fetch ?? fetch;
  const init: RequestInit = { method: "GET" };
  if (dispatcher) {
    (init as { dispatcher?: unknown }).dispatcher = dispatcher;
  }
  return (await impl(url, init)).status;
}

// REACHED, because an unreached body is never lowered and this file would
// then compile clean -- which is exactly how it failed the first time this
// row was rewritten.
void fetchThrough("http://127.0.0.1:1/x", {}).catch(() => console.log("caught"));

// THE SURVIVING REFUSAL. The same write, through a value whose type proves
// nothing. It must not be delegated on the strength of the key's NAME.
declare const opaqueProxy: unknown;

export async function viaUnknown(url: string): Promise<number> {
  const init: RequestInit = { method: "GET" };
  (init as { dispatcher?: unknown }).dispatcher = opaqueProxy;
  return (await fetch(url, init)).status;
}

void viaUnknown("http://127.0.0.1:1/x").catch(() => console.log("caught"));

// The same record WITHOUT the `fetch` member compiles: the RegExp field
// the census blamed is not a blocker, and its absence from this snapshot
// says so.
interface PatternOnly {
  readonly url?: string;
  readonly versionPattern?: RegExp;
}

function describePattern(options: PatternOnly = {}): string {
  const pattern = options.versionPattern ?? /x/;
  return pattern.source + "|" + (options.url ?? "");
}

console.log(describePattern());
