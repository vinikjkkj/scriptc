// laziness, close and ordering through an untyped value
const log = [];
function logging(name, n, opts) {
  opts = opts || {};
  let i = 0;
  const it = {
    next() {
      log.push(name + ".next" + i);
      if (opts.throwAt === i) throw new Error(name + " boom");
      if (opts.badAt === i) return 5;
      return i < n ? { value: i++, done: false } : { value: "r", done: true };
    },
  };
  if (!opts.noReturn) it.return = function () { log.push(name + ".return"); return opts.badReturn ? 1 : { value: undefined, done: true }; };
  return { [Symbol.iterator]() { log.push(name + ".iter"); return it; } };
}
function run(label, fn) {
  log.length = 0;
  try { fn(); } catch (e) { log.push("caught " + e.message); }
  console.log(label + ": " + log.join(" "));
}
function drain(o) { for (const v of o) log.push("v" + v); }
run("full", () => drain(logging("a", 2)));
run("break", () => { for (const v of logging("b", 5)) { log.push("v" + v); if (v === 1) break; } });
run("throw-body", () => { for (const v of logging("c", 5)) { throw new Error("body"); } });
run("return-in-fn", () => { (function () { for (const v of logging("d", 5)) { return v; } })(); });
run("next-throws", () => drain(logging("e", 5, { throwAt: 1 })));
run("bad-result", () => drain(logging("f", 5, { badAt: 1 })));
run("no-return", () => { for (const v of logging("g", 5, { noReturn: true })) break; });
run("bad-return", () => { for (const v of logging("h", 5, { badReturn: true })) break; });
run("continue", () => { for (const v of logging("i", 3)) { if (v === 0) continue; log.push("v" + v); } });
run("nested", () => { for (const a of logging("x", 2)) for (const b of logging("y", 2)) { log.push(a + "" + b); if (b === 1) break; } });
function* infinite() { let n = 0; while (true) yield n++; }
function use2(x) { return x; }
function mkinf() { return { [Symbol.iterator]: function () { let n = 0; return { next() { return { value: n++, done: false }; }, return() { log.push("inf.return"); return { value: undefined, done: true }; } }; } }; }
run("infinite", () => { for (const v of use2(mkinf())) { if (v >= 3) break; log.push("v" + v); } });
run("spread", () => log.push([...logging("s", 3)].join("")));
run("spread-throws", () => [...logging("t", 5, { throwAt: 2 })]);
function ni(x) { for (const v of x) {} }
run("not-iterable", () => ni({}));
run("not-iterable-num", () => ni(5));
run("array-fast", () => { for (const v of [1, 2, 3]) log.push("v" + v); });
run("string-fast", () => { for (const v of "ab") log.push(v); });
run("map-fast", () => { for (const [k, v] of new Map([[1, 2]])) log.push(k + "=" + v); });
