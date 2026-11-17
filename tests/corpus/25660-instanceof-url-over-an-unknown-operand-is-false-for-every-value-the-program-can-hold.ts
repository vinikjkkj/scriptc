// `value instanceof URL` where `value` is `unknown` (the proxy-agent shape: a field typed `unknown`). No URL can sit in an `unknown` of a compiled program
// (typed values do not convert to it), so the test answers false for every value that can be there; a URL-typed or `string | URL` operand keeps its own answer.
interface AgentLike { readonly proxy?: unknown }
function readProxy(agent: AgentLike): string {
  const value = agent.proxy;
  if (value instanceof URL) return "url:" + value.href;
  if (typeof value === "string") {
    try { return "parsed:" + new URL(value).host; } catch { return "bad:" + value; }
  }
  if (value !== null && typeof value === "object") return "endpoint:" + Object.keys(value).join(",");
  return "none";
}
console.log(readProxy({ proxy: "http://proxy.test:8080/x" }), readProxy({ proxy: "not a url" }), readProxy({ proxy: { host: "h", port: 1 } }), readProxy({ proxy: 7 }), readProxy({}));
function address(a: string | URL): string { return a instanceof URL ? "u:" + a.pathname : "s:" + a; }
console.log(address(new URL("http://a.test/p/q")), address("plain"));
const plain = new URL("http://b.test/z");
console.log(plain instanceof URL, ([1, 2] as unknown) instanceof URL);
