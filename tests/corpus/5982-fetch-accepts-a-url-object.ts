// `fetch` takes `string | URL`, and a URL argument must be serialized the
// way fetch serializes one — through `href`, not through some other
// stringification. A client that dropped the query, or that stringified
// the object some other way, would reach a DIFFERENT resource and the
// caller would never know.
//
// The target is a closed loopback port, so both lanes reject; what is
// compared is that the URL form and the equivalent string form answer
// identically, and that the URL's own parts survive alongside.
//
// The two calls are written separately rather than through one
// `string | URL` parameter: a union of those two arms has no static
// representation yet (SC2001), which is a union limitation and not a
// fetch one.

async function viaUrl(u: URL): Promise<string> {
  try {
    await fetch(u);
    return "RESOLVED";
  } catch (e) {
    return (e as Error).name + "/" + (e as Error).message;
  }
}

async function viaString(s: string): Promise<string> {
  try {
    await fetch(s);
    return "RESOLVED";
  } catch (e) {
    return (e as Error).name + "/" + (e as Error).message;
  }
}

async function main(): Promise<void> {
  const u = new URL("http://127.0.0.1:1/path?q=1&r=2");
  console.log("href", u.href);
  console.log("host", u.host);
  console.log("pathname", u.pathname);
  console.log("url ", await viaUrl(u));
  console.log("str ", await viaString("http://127.0.0.1:1/path?q=1&r=2"));
  console.log("done");
}

void main();
