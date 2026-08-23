// The TYPE half of the row, on its own: a record carrying members whose
// signatures mention `Response` and `Headers` compiles, and the record
// behaves like any other record.
//
// This is the shape zapo's `WaFetchVersionOptions` has and the reason the
// row existed at all: the declaration refused, so every USE of it
// inherited the blocker and nothing in the module compiled. Nothing here
// calls fetch or touches the network — the point is that the DECLARATION
// is legal and its optional members stay absent.

interface Hooks {
  readonly timeoutMs?: number;
  readonly onResponse?: (input: string) => Promise<Response>;
  readonly onHeaders?: (input: string) => Promise<Headers>;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

function describe(h: Hooks): string {
  const parts: string[] = [];
  parts.push("timeoutMs=" + String(h.timeoutMs ?? -1));
  parts.push("onResponse=" + String(h.onResponse === undefined));
  parts.push("onHeaders=" + String(h.onHeaders === undefined));
  parts.push("signal=" + String(h.signal === undefined));
  parts.push("headers=" + String(h.headers === undefined));
  return parts.join(" ");
}

console.log(describe({}));
console.log(describe({ timeoutMs: 10 }));
const ctl = new AbortController();
console.log(describe({ timeoutMs: 3, signal: ctl.signal, headers: { a: "1" } }));
console.log("done");
