/* A per-source-file cache for the strings the tsgo AST client decodes.
 *
 * Every string property of a client node (`identifier.text`, `literal.text`, a file's `path`, the `id` of a node the checker is asked about) is
 * `RemoteNode.getString(index)`: a read of the file's string table, a `TextDecoder` pass (which first scans the bytes for a WTF-8 surrogate lead
 * with `Buffer.indexOf`) and a fresh string, on EVERY read. The lowering reads the same node's text over and over (each walker tests
 * `n.expression.text === "Proxy"`, every checker query computes the node id from the file path): on a one-file build the client made 35.5M
 * getString calls for 249,036 distinct (file, index) pairs, and the decode path was 6-8% of the process's CPU.
 *
 * The answer is a pure function of (file, index): a source file object is one immutable snapshot's parse, and its string table never changes. So
 * the decoded string is kept on the file object (freed with it, so a program reload frees its strings) and handed back on every later read. The
 * class that owns getString is not exported by the package, so it is found from a live node's prototype chain and patched once; a client without
 * the method (a different package version) is left alone. */
const CACHE = "_scrStrings";
let patched: object | null = null;

export function installNodeStringCache(anyNode: object): void {
  if (patched !== null) return;
  let proto: object | null = Object.getPrototypeOf(anyNode) as object | null;
  while (proto !== null && !Object.hasOwn(proto, "getString")) proto = Object.getPrototypeOf(proto) as object | null;
  if (proto === null) return;
  const owner = proto as { getString?: unknown };
  const orig = owner.getString;
  if (typeof orig !== "function") return;
  patched = proto;
  owner.getString = function (this: { sourceFile: Record<string, unknown> }, index: number): string {
    const sf = this.sourceFile;
    let cache = sf[CACHE] as Map<number, string> | undefined;
    if (cache === undefined) {
      cache = new Map();
      sf[CACHE] = cache;
    }
    let s = cache.get(index);
    if (s === undefined) {
      s = (orig as (i: number) => string).call(this, index);
      cache.set(index, s);
    }
    return s;
  };
}
