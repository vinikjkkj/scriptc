// The RequestInit-as-a-VALUE differential. Every line is one cell; the
// harness compares each against Node v25.9.0 by its leading key.
//
// The silent failures this fixture exists to catch:
//   an option DROPPED when the init is a value rather than a literal
//   an init CONSUMED by the first request it is used in
//   an injected `fetch` NOT called, the real network used instead
//   a signal that rides an init value and never aborts
//   the value form and the direct call disagreeing about one request
//   `f === fetch` answering false because the value was adapted

const HTTP = "__HTTP__";

function say(k: string, v: string): void {
  console.log(`${k} ${v}`);
}

/** zapo's own shape: an options record whose `fetch` member is typed
 * `typeof fetch`. This record is what refused before RequestInit and
 * Request had types — the whole function below never lowered. */
interface FetchOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly userAgent?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

/** wa-version-fetcher.ts's fetchSourceText, reduced to what it does. */
async function sourceText(url: string, options: FetchOptions): Promise<string> {
  const fetchImpl = options.fetch ?? fetch;
  const headers: Record<string, string> = { "x-test": options.userAgent ?? "ua" };
  if (options.headers) {
    for (const key in options.headers) {
      headers[key.toLowerCase()] = options.headers[key]!;
    }
  }
  const init: RequestInit = { method: "GET", headers };
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }
  return await response.text();
}

async function main(): Promise<void> {
  // ── the init as a VALUE, every option ──────────────────────────────
  {
    const init: RequestInit = {
      method: "POST",
      headers: { "x-test": "one", "content-type": "text/plain" },
      body: "payload",
    };
    const r = await fetch(HTTP + "/echo", init);
    say("value-post", `${r.status} ${await r.text()}`);
    // The SAME init again: an init consumed by its first use is the
    // failure this cell exists for.
    const r2 = await fetch(HTTP + "/echo", init);
    say("value-post-again", await r2.text());
  }
  // An EMPTY init is a GET with no body — not an empty body.
  {
    const init: RequestInit = {};
    const r = await fetch(HTTP + "/echo", init);
    say("value-empty", await r.text());
  }
  // The literal and the value must describe the SAME request.
  {
    const direct = await fetch(HTTP + "/echo", { method: "PUT", body: "z", headers: { "x-test": "lit" } });
    const init: RequestInit = { method: "PUT", body: "z", headers: { "x-test": "lit" } };
    const viaValue = await fetch(HTTP + "/echo", init);
    const a = await direct.text();
    const b = await viaValue.text();
    say("literal-equals-value", `${a === b} ${b}`);
  }
  // headers as a RECORD VALUE rather than a literal (the runtime walk).
  {
    const hs: Record<string, string> = { "X-Test": "rec", "content-type": "text/plain" };
    const init: RequestInit = { method: "POST", headers: hs, body: "q" };
    const r = await fetch(HTTP + "/echo", init);
    say("value-header-record", await r.text());
  }
  // A non-2xx through the value path RESOLVES.
  {
    const init: RequestInit = { method: "GET" };
    const r = await fetch(HTTP + "/404", init);
    say("value-404", `${r.ok} ${r.status} ${await r.text()}`);
  }

  // ── the signal, carried BY the init value ──────────────────────────
  {
    const c = new AbortController();
    c.abort();
    const init: RequestInit = { signal: c.signal };
    try {
      await fetch(HTTP + "/ok", init);
      say("value-preaborted", "RESOLVED");
    } catch (e) {
      say("value-preaborted", (e as Error).name);
    }
  }
  {
    const c = new AbortController();
    const init: RequestInit = { signal: c.signal };
    const p = fetch(HTTP + "/slow", init);
    setTimeout(() => c.abort(), 60);
    try {
      await p;
      say("value-abort-inflight", "RESOLVED");
    } catch (e) {
      say("value-abort-inflight", (e as Error).name);
    }
  }

  // ── fetch as a VALUE, at the ambient signature ─────────────────────
  {
    const f = fetch;
    say("identity-self", `${fetch === fetch}`);
    say("identity-alias", `${f === fetch}`);
    const r = await f(HTTP + "/ok");
    say("value-fn-noinit", `${r.status} ${await r.text()}`);
    const init: RequestInit = { method: "POST", body: "vf", headers: { "x-test": "vf" } };
    const r2 = await f(HTTP + "/echo", init);
    say("value-fn-init", await r2.text());
    // An explicit `undefined` init is an ABSENT init, not an empty one.
    const r3 = await f(HTTP + "/echo", undefined);
    say("value-fn-undefined", await r3.text());
    // The URL arm of the input union.
    const r4 = await f(new URL(HTTP + "/ok"));
    say("value-fn-url", `${r4.status} ${await r4.text()}`);
  }

  // ── the options record: the default, and an INJECTED impl ──────────
  {
    say("record-default", await sourceText(HTTP + "/echo", {}));
    say("record-ua", await sourceText(HTTP + "/echo", { userAgent: "injected-ua" }));
    say("record-headers", await sourceText(HTTP + "/echo", { headers: { "X-Test": "MERGED" } }));
  }
  {
    // The whole POINT of the `fetch` option: the stub must be called, and
    // the init must reach it. A silently-real fetch would answer /echo
    // with x-test: ua and look almost right.
    let calls = 0;
    const stub: typeof fetch = (input, init) => {
      calls++;
      return fetch(HTTP + "/echo?stub=1", init);
    };
    const body = await sourceText(HTTP + "/ok", { fetch: stub, userAgent: "through-stub" });
    say("record-injected", `${calls} ${body}`);
  }
  {
    // A record that stores the AMBIENT fetch in the option: the field and
    // the global must be the same function.
    const opts: FetchOptions = { fetch: fetch };
    say("record-stores-ambient", `${opts.fetch === fetch}`);
    say("record-through-ambient", await sourceText(HTTP + "/echo", opts));
  }

  // ── an init built in one function and used in another ──────────────
  {
    const built = ((): RequestInit => ({ method: "POST", body: "crossfn", headers: { "x-test": "x" } }))();
    const r = await fetch(HTTP + "/echo", built);
    say("value-cross-function", await r.text());
  }
  // An init held in an ARRAY and read back.
  {
    const inits: RequestInit[] = [{ method: "POST", body: "arr0" }, { method: "PUT", body: "arr1" }];
    const r0 = await fetch(HTTP + "/echo", inits[0]!);
    const r1 = await fetch(HTTP + "/echo", inits[1]!);
    say("value-in-array", `${await r0.text()} | ${await r1.text()}`);
  }
  // An init captured by a closure that outlives its frame.
  {
    const make = (): (() => Promise<Response>) => {
      const init: RequestInit = { method: "POST", body: "closure", headers: { "x-test": "c" } };
      return () => fetch(HTTP + "/echo", init);
    };
    const go = make();
    say("value-captured", await (await go()).text());
    say("value-captured-again", await (await go()).text());
  }

  say("END", "done");
}

void main();
