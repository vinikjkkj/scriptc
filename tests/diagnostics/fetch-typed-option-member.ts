// An options record with a `fetch?: typeof fetch` member — the
// inject-your-own-fetch idiom.
//
// This pin exists because of what the refusal is NOT. zapo reports it at
// `transport/wa-version-fetcher.ts:211` as "values of type
// 'WaFetchLatestMobileVersionOptions' have no static representation", and
// a census read that type name and recorded the cause as "an interface
// with a RegExp field". It is neither the interface nor the RegExp. Asked
// through SCRIPTC_DYN_WHY, the refusal chain is four frames deep and ends
// somewhere the message never mentions:
//
//   MEMBER   WaFetchLatestMobileVersionOptions . fetch : ((input: ...) => ...)
//     UNIONARM  (the fetch signature) | undefined . arm (input: ...) => ...
//       FNPARAM   (input: string | Request | URL, ...) . input
//         UNIONARM  string | Request | URL . arm Request
//
// The leaf is `Request`. `Response`, `RequestInit`, `AbortSignal` and
// `Headers` are all handled as island ambients and `AbortSignal` has a
// static representation of its own precisely because it is "overwhelmingly
// an optional field on an options record that the program never touches";
// `Request` is in none of those groups, so a signature that merely NAMES
// it takes the whole options record — and every function whose parameter
// is one — out of the static tier.
//
// This one KEEPS its SC2011, on both sides of the change that moved the
// three object-literal sites off it, and that is the control: here the
// static mapping really is null (the chain above is a real refusal), and
// the dynamic mapping really does answer, so both halves of the message
// are true. The fix narrows the branch to exactly the sites where they
// are not. The SC2004 below it is the second trap the cause carries: the
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
