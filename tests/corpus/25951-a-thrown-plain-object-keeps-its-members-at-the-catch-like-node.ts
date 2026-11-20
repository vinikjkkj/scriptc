// A thrown plain object, nested object, array and class instance keep their members when the catch binding is read untyped
// (`catch (e: any)`): the member reads, typeof, a rethrow and a second catch of the same value, and the value as it was at the throw.
function t(f: () => void, label: string): void {
  try { f(); } catch (e: any) { console.log(label, e.code, e.message, typeof e, e.nested === undefined ? "-" : JSON.stringify(e.nested)); }
}
class Foo { code = "C1"; extra = [1, 2]; label(): string { return "foo"; } }
t(() => { throw { code: "O1", message: "obj" }; }, "plain");
t(() => { throw { code: 7, nested: { a: [1, 2, { z: "q" }] } }; }, "nested");
t(() => { const o = { code: "X", message: "m" }; o.message = "changed"; throw o; }, "var");
t(() => { throw [1, 2, 3]; }, "array");
t(() => { throw new Foo(); }, "class");
t(() => { try { throw { code: "inner" }; } catch (e: any) { throw { code: e.code + "+outer" }; } }, "wrapped");
function rethrow(): void { try { throw { code: "R1", message: "again" }; } catch (e) { throw e; } }
t(rethrow, "rethrown");
const seen: string[] = [];
for (let i = 0; i < 3; i++) {
  try { throw { code: "L" + i, n: i * 2 }; } catch (e: any) { seen.push(e.code + ":" + e.n); }
}
console.log(seen.join(","));
