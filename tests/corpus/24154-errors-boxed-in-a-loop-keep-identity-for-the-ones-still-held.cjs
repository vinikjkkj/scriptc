// An error that crosses into an untyped slot keeps ONE identity for as long as the program can reach it, however many other
// errors are boxed and dropped around it: held ones compare equal to themselves after a rethrow, keep their expandos and
// stay `instanceof Error`; the dropped ones leave no trace.
function make(i) { return new Error("e" + i); }
function relay(v) { return v; }
const held = [];
for (let i = 0; i < 12; i++) {
  const e = relay(make(i));
  e.tag = "t" + i;
  held.push(e);
}
let churn = 0;
for (let i = 0; i < 30000; i++) {
  const d = relay(make(i));
  churn += d.message.length;
}
let same = 0, kept = 0, inst = 0, thrownSame = 0;
for (let i = 0; i < held.length; i++) {
  const e = held[i];
  if (relay(e) === e) same++;
  if (e.tag === "t" + i && e.message === "e" + i) kept++;
  if (e instanceof Error) inst++;
  try { throw e; } catch (x) { if (x === e) thrownSame++; }
}
for (let i = 0; i < 30000; i++) churn += relay(make(i)).message.length;
let after = 0;
for (let i = 0; i < held.length; i++) if (relay(held[i]) === held[i] && held[i].tag === "t" + i) after++;
// The same for a user class's error: thrown, caught into an untyped binding and passed on, 30000 times around a few held ones.
class DbErr extends Error { constructor(m, code) { super(m); this.code = code; this.name = "DbErr"; } }
function thrower(i) { throw new DbErr("d" + i, "C" + (i % 7)); }
const heldDb = [];
for (let i = 0; i < 8; i++) {
  try { thrower(i); } catch (e) { const d = relay(e); d.tag = "g" + i; heldDb.push(d); }
}
let dbChurn = 0;
for (let i = 0; i < 30000; i++) {
  try { thrower(i); } catch (e) { const d = relay(e); dbChurn += d.message.length + d.code.length + (d instanceof DbErr ? 1 : 0); }
}
let dbSame = 0, dbKept = 0;
for (let i = 0; i < heldDb.length; i++) {
  const d = heldDb[i];
  if (relay(d) === d && d instanceof DbErr) dbSame++;
  if (d.tag === "g" + i && d.message === "d" + i && d.code === "C" + (i % 7)) dbKept++;
  try { throw d; } catch (x) { if (x === d) dbSame++; }
}
console.log(churn, same, kept, inst, thrownSame, after, dbChurn, dbSame, dbKept);
