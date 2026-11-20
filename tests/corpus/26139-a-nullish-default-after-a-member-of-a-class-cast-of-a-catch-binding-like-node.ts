// A default after a member of a class cast of a catch binding: the member the payload lacks takes the default, like Node.
class MyErr extends Error { code = 5; constructor(m: string) { super(m); } }
try { throw "s"; } catch (e) { const x = e as MyErr; console.log(x.code ?? "none", (e as MyErr).code ?? "dflt"); const n: number = x.code ?? 7; console.log(n); }
try { throw new MyErr("m"); } catch (e) { const x = e as MyErr; console.log(x.code ?? "none", x.message ?? "nomsg"); }
