// A method call on a const class cast of a catch binding: the instance's own method, or Node's TypeError text for any other payload.
class MyErr extends Error {
  code = 5;
  constructor(m: string) { super(m); }
  hello(n: number): string { return "hi " + this.code + " " + n; }
  get2(): number { return this.code * 2; }
}
try { throw "x"; } catch (e) {
  const x = e as MyErr;
  try { x.hello(1); } catch (e2: any) { console.log(e2 instanceof TypeError, e2.message); }
}
try { throw new MyErr("m"); } catch (e) {
  const x = e as MyErr;
  console.log(x.hello(7), x.get2() + 1, x.hello(2).length);
}
try { throw new Error("plain"); } catch (e) {
  const x = e as MyErr;
  try { console.log(x.get2()); } catch (e2: any) { console.log(e2.message); }
}
