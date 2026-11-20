// `(e as {code?: string}).code` on a catch binding: the cast is erased, the member read answers whatever the thrown value has (the
// member of an Error or a subclass, undefined for a string or a number), in a read, a typed local and an index-signature view.
class CodeErr extends Error { code: string; constructor(m: string, c: string) { super(m); this.code = c; } }
function t(f: () => void): void {
  try { f(); } catch (e) {
    console.log((e as { code?: string }).code);
    console.log((e as { message?: string }).message);
    const n = (e as { code?: string }).code;
    console.log(typeof n, n === undefined);
    console.log((e as { [k: string]: unknown })["code"]);
  }
}
t(() => { throw new CodeErr("x", "E1"); });
t(() => { throw new Error("plain"); });
t(() => { throw "str"; });
t(() => { throw 42; });
