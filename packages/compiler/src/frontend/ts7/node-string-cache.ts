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
 * class that owns getString is not exported by the package, so it is found from a live node's prototype chain and patched once.
 *
 * It is an optimisation over a third-party class, so it must never change behaviour when that class changes shape (a dependency update):
 *   - the patch applies only when the owner has a plain, writable `getString` function of one parameter, and when a probe read through the patched
 *     method answers exactly what the original answered for the same node (the file's own `fileName`, which is a getString read);
 *   - a patched method falls back to the original for any receiver that does not look like a client node (no object `sourceFile`);
 *   - any failure of the checks restores the original and leaves the cache OFF, reported by nodeStringCacheStatus() so a test can tell
 *     "patched" from "absent" (test/ts7/node-string-cache.test.ts fails if the real client stops being patched). */
const CACHE = "_scrStrings";
export type NodeStringCacheStatus = "unpatched" | "patched" | "absent";
let status: NodeStringCacheStatus = "unpatched";

export function nodeStringCacheStatus(): NodeStringCacheStatus {
  return status;
}

export function installNodeStringCache(anyNode: object): void {
  if (status !== "unpatched") return;
  let proto: object | null = Object.getPrototypeOf(anyNode) as object | null;
  while (proto !== null && !Object.hasOwn(proto, "getString")) proto = Object.getPrototypeOf(proto) as object | null;
  if (proto === null) {
    status = "absent";
    return;
  }
  const desc = Object.getOwnPropertyDescriptor(proto, "getString");
  const orig = desc?.value as ((this: unknown, i: number) => string) | undefined;
  if (desc === undefined || typeof orig !== "function" || orig.length !== 1 || desc.writable !== true || desc.configurable !== true) {
    status = "absent";
    return;
  }
  const cached = function (this: { sourceFile?: unknown }, index: number): string {
    const sf = this.sourceFile as Record<string, unknown> | null | undefined;
    if (sf === null || sf === undefined || typeof sf !== "object") return orig.call(this, index);
    let cache = sf[CACHE] as Map<number, string> | undefined;
    if (cache === undefined) {
      cache = new Map();
      sf[CACHE] = cache;
    }
    let s = cache.get(index);
    if (s === undefined) {
      s = orig.call(this, index);
      cache.set(index, s);
    }
    return s;
  };
  // Probe: the file's own fileName is a string-table read; it must come back identical through the patched method (twice: miss, then hit).
  let probeOk = false;
  const before = (anyNode as { fileName?: unknown }).fileName;
  Object.defineProperty(proto, "getString", { ...desc, value: cached });
  try {
    const a = (anyNode as { fileName?: unknown }).fileName;
    const b = (anyNode as { fileName?: unknown }).fileName;
    probeOk = typeof before === "string" && a === before && b === before;
  } catch {
    probeOk = false;
  }
  if (!probeOk) {
    Object.defineProperty(proto, "getString", desc);
    delete (anyNode as Record<string, unknown>)[CACHE];
    status = "absent";
    return;
  }
  status = "patched";
}
