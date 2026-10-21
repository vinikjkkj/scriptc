class S {
  static n: number;
  static s: string;
  static b: boolean;
  static o: { v: number };
  static ok: number = 3;
  static bump() { S.n += 1; }
}
console.log(S.n, S.s, S.b, typeof S.o, S.ok);
console.log(S.n === undefined, S.s ?? "dflt", S.b ? "t" : "f");
try { console.log(S.s.length); } catch (e) { console.log((e as Error).message); }
try { console.log(S.o.v); } catch (e) { console.log((e as Error).message); }
console.log(S.n + 1, S.n * 2);
S.n = 4;
S.s = "str";
S.b = true;
S.o = { v: 9 };
console.log(S.n, S.s, S.b, S.o.v, S.s.length);
S.bump();
S.n++;
S.n += 2;
console.log(S.n);
class D extends S {}
console.log(D.n, D.s);
class W2 { static n: number; static s: string; static u?: number; }
W2.n = 1;
W2.n += 1; W2.n++;
console.log(W2.n);
W2.s = "a"; W2.s += "b";
console.log(W2.s);
class V2 { static n: number; static s: string; }
V2.n += 1;
V2.s += "x";
console.log(V2.n, V2.s);
V2.n++;
console.log(V2.n);
