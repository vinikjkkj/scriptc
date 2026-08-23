/* `fetch` held as a VALUE, against a real origin, compared against Node.
 *
 * The other half of pure.ts. It is separate because it needs the
 * fetch-static origin process, and it is the half that decides zapo's
 * row 5: `options.fetch ?? fetch`.
 *
 * The VALUE form carries the AMBIENT signature — `(input: string |
 * Request | URL, init?: RequestInit) => Promise<Response>`. It was arity
 * ONE while `RequestInit` had no type at all, and every slot in this file
 * was annotated to match that narrower shape; they say `typeof fetch` now,
 * which is what a program would write and what keeps IDENTITY. A slot of
 * some OTHER function type is a refusal, not an adapter, and the boundary
 * test in builtin-fn-value.test.ts is why: an adapter is a fresh closure,
 * so the value held there would compare unequal to `fetch` where Node
 * compares equal.
 *
 * Every cell below compares the value form against Node's own `fetch`, on
 * the same origin, in the same process order — including the two things
 * a wrong answer would hide: the request the server actually SEES when it
 * arrives through the value, and a network failure REJECTING rather than
 * resolving.
 *
 * __HTTP__ / __ALT__ are substituted before compiling: a static build has
 * no runtime string it could assemble a URL literal from, and the
 * compared program must be byte-identical in both lanes.
 */

function log(key: string, value: string): void {
  console.log(`${key} ${value}`);
}

const f = fetch;
const rec: { call: typeof fetch } = { call: fetch };
const arr: Array<typeof fetch> = [fetch];

function takes(g: typeof fetch): boolean {
  return g === fetch;
}

function gives(): typeof fetch {
  return fetch;
}

function makeCapture(): () => boolean {
  const inner = fetch;
  return () => inner === fetch;
}

async function main(): Promise<void> {
  // ---------------------------------------------------------- identity
  log("id-self", String(fetch === fetch));
  log("id-alias", String(f === fetch));
  log("id-record-field", String(rec.call === fetch));
  log("id-array-elem", String(arr[0] === fetch));
  log("id-argument", String(takes(fetch)));
  log("id-argument-alias", String(takes(f)));
  log("id-returned", String(gives() === fetch));
  log("id-returned-twice", String(gives() === gives()));
  log("id-capture", String(makeCapture()()));
  log("typeof", typeof fetch);
  log("typeof-alias", typeof f);

  // ------------------------------------ the ?? default: zapo's own shape
  const optAbsent: { fetch?: typeof fetch } = {};
  const chosen = optAbsent.fetch ?? fetch;
  log("nullish-absent-identity", String(chosen === fetch));

  let stubCalls = 0;
  // The stub carries the AMBIENT signature and FORWARDS its input, which
  // is the shape a program injecting a fetch really writes -- and which
  // needs the input UNION to reach the call.
  const stub: typeof fetch = async (input, init) => {
    stubCalls++;
    return await fetch(input, init);
  };
  const optPresent: { fetch?: typeof fetch } = { fetch: stub };
  const overridden = optPresent.fetch ?? fetch;
  log("nullish-present-identity", String(overridden === fetch));

  // ------------------------------------------------ calling through it
  const okDirect = await fetch("__HTTP__/ok");
  const okValue = await chosen("__HTTP__/ok");
  log("ok-status", `${String(okDirect.status)} ${String(okValue.status)}`);
  log("ok-ok", `${String(okDirect.ok)} ${String(okValue.ok)}`);
  const okDirectText = await okDirect.text();
  const okValueText = await okValue.text();
  log("ok-body-equal", String(okDirectText === okValueText));
  log("ok-body-len", String(okValueText.length));

  // A non-2xx must RESOLVE through the value exactly as it does directly.
  const notFound = await chosen("__HTTP__/404");
  log("404-status", String(notFound.status));
  log("404-ok", String(notFound.ok));
  log("404-body", await notFound.text());

  // The value follows redirects, and reports the final URL.
  const redirected = await chosen("__HTTP__/redir302");
  log("redir-status", String(redirected.status));
  log("redir-redirected", String(redirected.redirected));
  log("redir-body-len", String((await redirected.text()).length));

  // json() through the value.
  const json = await chosen("__HTTP__/json");
  const parsed = (await json.json()) as { b: string };
  log("json-b", parsed.b);

  // A header read through a response the VALUE produced.
  const headed = await chosen("__HTTP__/headers");
  log("hdr-mixed", String(headed.headers.get("x-mixed-case")));
  log("hdr-absent", String(headed.headers.get("x-nope")));
  await headed.text();

  // THE REQUEST THE SERVER SEES. The value form sends the same request
  // the one-argument direct call sends — method, absent body, and the
  // default header set. A value that quietly sent something else would
  // pass every cell above.
  const echoDirect = await fetch("__ALT__/echo");
  const echoValue = await chosen("__ALT__/echo");
  const echoDirectText = await echoDirect.text();
  const echoValueText = await echoValue.text();
  log("echo-equal", String(echoDirectText === echoValueText));
  log("echo-seen", echoValueText);

  // A stale binding: the `let` is reassigned to a stub, and the OLD value
  // must still be the real fetch through whatever else holds it.
  let slot: typeof fetch = fetch;
  const held = slot;
  log("stale-before-identity", String(slot === fetch));
  slot = stub;
  log("stale-after-identity", String(slot === fetch));
  log("stale-held-identity", String(held === fetch));
  const viaStub = await slot("__HTTP__/ok");
  log("stale-stub-status", String(viaStub.status));
  log("stale-stub-calls", String(stubCalls));
  await viaStub.text();
  const viaHeld = await held("__HTTP__/ok");
  log("stale-held-status", String(viaHeld.status));
  log("stale-held-calls-unchanged", String(stubCalls));
  await viaHeld.text();

  // A NETWORK failure must REJECT through the value, with Node's own
  // TypeError. A value form that resolved here would be the single
  // quietest way this feature could be wrong.
  try {
    const dead = await chosen("http://127.0.0.1:1/nothing");
    log("refused", `NO THROW ${String(dead.status)}`);
  } catch (e) {
    const err = e as Error;
    log("refused", `${err.name} ${err.message}`);
  }
  try {
    await fetch("http://127.0.0.1:1/nothing");
    log("refused-direct", "NO THROW");
  } catch (e) {
    const err = e as Error;
    log("refused-direct", `${err.name} ${err.message}`);
  }

  log("END", "done");
}

main().then(
  () => {},
  (e: unknown) => {
    console.log(`FATAL ${String(e)}`);
  },
);
