// An options record with a `fetch?: typeof fetch` member — the
// inject-your-own-fetch idiom.
//
// This pin exists because of what the refusal is NOT. zapo reports it at
// `transport/wa-version-fetcher.ts:211` as "values of type
// 'WaFetchLatestMobileVersionOptions' have no static representation", and
// a census read that type name and recorded the cause as "an interface
// with a RegExp field". It is neither the interface nor the RegExp. Asked
// through SCRIPTC_DYN_WHY, the refusal chain is four frames deep and ends
// somewhere the message never mentions — and the LEAF depends on which
// `fetch` declaration the lane sees, which is the correction below:
//
//   MEMBER   VersionOptions . fetch : ((input: ...) => Promise<Response>)
//     UNIONARM  (the fetch signature) | undefined . arm (input: ...) => ...
//       FNPARAM   (input: string | URL, init?: RequestInit | undefined) . init
//         UNIONARM  RequestInit | undefined . arm RequestInit
//
// That is THIS lane, MEASURED: no tsconfig reaches tests/diagnostics, so
// the program compiles against the shipped fallback .d.ts, whose `fetch`
// is `(input: string | URL, init?: RequestInit)` — `Request` is not
// declared at all here. Under zapo's real @types/node the first parameter
// is `RequestInfo | URL` and the leaf is `Request` instead. Either way the
// leaf is an island-ambient (or absent) TYPE, never the RegExp: `Response`,
// `RequestInit`, `AbortSignal` and `Headers` are island ambients, and
// `AbortSignal` alone has a static representation, "overwhelmingly an
// optional field on an options record that the program never touches".
//
// This one KEEPS its SC2011: here the static mapping really is null and
// the dynamic mapping really does answer, so both halves of the message
// are true. The SC2004 below it is the second trap the cause carries: the
// parameter blocks the declaration, and every use inherits it.

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
