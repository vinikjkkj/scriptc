// Every way a static `fetch` can FAIL, and the one property that matters
// for all of them: they REJECT. A client that answered a Response for a
// refused connection, an unparsable URL or an already-aborted signal
// would be silently wrong in exactly the way a refusal never is — the
// caller's `if (!r.ok)` would pass and a bad value would flow on.
//
// Nothing here needs a server: a closed loopback port, a URL that cannot
// parse, a scheme fetch does not speak, and a signal aborted before the
// call are all deterministic on both lanes.
//
// Node v25.9.0 is the oracle for every line, including the exact error
// text: a network failure is a TypeError whose message is precisely
// "fetch failed", and an abort is an AbortError.

function shape(e: unknown): string {
  const err = e as Error;
  return err.name + "/" + err.message;
}

async function main(): Promise<void> {
  try {
    await fetch("http://127.0.0.1:1/nothing");
    console.log("refused RESOLVED");
  } catch (e) {
    console.log("refused", shape(e));
  }

  try {
    await fetch("::this is not a url::");
    console.log("badurl RESOLVED");
  } catch (e) {
    console.log("badurl", (e as Error).name);
  }

  try {
    await fetch("file:///etc/hosts");
    console.log("scheme RESOLVED");
  } catch (e) {
    console.log("scheme", (e as Error).name);
  }

  const c = new AbortController();
  c.abort();
  try {
    await fetch("http://127.0.0.1:1/nothing", { signal: c.signal });
    console.log("preabort RESOLVED");
  } catch (e) {
    console.log("preabort", (e as Error).name);
  }

  console.log("done");
}

void main();
