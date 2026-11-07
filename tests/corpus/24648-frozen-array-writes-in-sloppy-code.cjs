// Object.freeze over a typed array sets a real frozen bit: writes through an alias of the original (here `base`, typed mutable) throw or are ignored exactly as Node does. CommonJS = sloppy code.
// sloppy (CommonJS): element, length and clear writes are silently ignored; the mutators throw
const t = (name, f) => { try { const r = f(); console.log(name, "ok", r === undefined ? "-" : r); } catch (e) { console.log(name, e.constructor.name + ": " + e.message); } };
/** @param {number[]} src */
function frozenCopy(src) { const base = src.slice(); Object.freeze(base); return base; }
const mk = () => frozenCopy([1, 2, 3]);
const all = [];
const a = mk();
console.log(Object.isFrozen(a), Object.isSealed(a), Object.isFrozen([1]), Object.isFrozen(5));
t("setIdx", () => { a[0] = 5; return a.join(); });
t("setBeyond", () => { a[7] = 5; return a.length; });
t("setLen", () => { a.length = 0; return a.length; });
t("push", () => a.push(9)); t("pop", () => a.pop()); t("shift", () => a.shift()); t("unshift", () => a.unshift(1));
t("reverse", () => a.reverse()); t("fill", () => a.fill(0)); t("fillEmpty", () => a.fill(0, 2, 2)); t("copyWithin", () => a.copyWithin(0, 1)); t("splice", () => a.splice(0, 1));
t("splice0", () => a.splice(0, 0)); t("spliceIns", () => a.splice(1, 0, 7)); t("sort", () => a.sort((x, y) => y - x));
const e = frozenCopy([]);
t("pushE", () => e.push(1)); t("popE", () => e.pop()); t("shiftE", () => e.shift()); t("reverseE", () => e.reverse()); t("unshiftE", () => e.unshift(2));
const one = frozenCopy([4]);
t("shift1", () => one.shift()); t("reverse1", () => one.reverse());
console.log(a.join(), a.length, e.length, one.join(), a.map((x) => x * 2).join(), a.slice(1).join(), [...a].join());
const live = [1, 2];
live.push(3); live[0] = 9; live.length = 2;
console.log(live.join(), Object.isFrozen(live));
