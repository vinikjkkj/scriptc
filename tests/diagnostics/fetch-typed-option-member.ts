// An options record with a `fetch?: typeof fetch` member -- the
// inject-your-own-fetch idiom -- and the ONE statement in that idiom that
// still refuses.
//
// WHAT THIS FILE USED TO PIN, AND WHY IT CHANGED. The record itself
// refused, zapo reported it at `transport/wa-version-fetcher.ts:211` as
// "values of type 'WaFetchLatestMobileVersionOptions' have no static
// representation", and a census read that type name and recorded the
// cause as "an interface with a RegExp field". It was neither the
// interface nor the RegExp: asked through SCRIPTC_DYN_WHY the chain was
// four frames deep and ended at `RequestInit` in this lane and at
// `Request` under real @types/node. That correction is what the file
// existed for.
//
// BOTH of those types map now, so the record COMPILES and this file no
// longer pins its refusal -- it pins the correction's other half. The
// `describeOptions` declaration below is exactly the shape that used to
// block, and the ABSENCE of any diagnostic on it is the assertion:
// nothing about the record, the RegExp field or the `typeof fetch` member
// blocks any more.
//
// What DOES refuse is one statement of the same idiom, and it is a
// capability rather than a type: an undici `dispatcher` written onto the
// init through an assertion. Measured against Node v25.9.0 -- `fetch(url,
// { dispatcher })` really does call a plain object's `dispatch(opts,
// handler)` and wait for its callbacks -- so there is nothing to drop
// quietly, and this is the refusal zapo carries at
// wa-version-fetcher.ts:133. It used to answer SC1090 "assignment to
// non-variables", which named neither the value nor the reason.
//
// The `PatternOnly` half below stays: the RegExp field the census blamed
// was never a blocker, and its absence from this snapshot still says so.

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

// The surviving refusal, in the same function's shape. `init` is a
// RequestInit VALUE; the dispatcher is the option this runtime has no
// representation for.
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
