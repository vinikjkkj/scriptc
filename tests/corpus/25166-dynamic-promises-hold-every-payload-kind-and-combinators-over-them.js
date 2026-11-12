// Promises whose payloads are dynamic values: number, boolean, string, undefined, null, an object with a cycle, an array, a function. Pending and
// settled, raced and gathered, adopted through async returns, a few left unsettled at exit.
"use strict";
class Cyc { constructor() { this.self = this; } }
function named() { return 9; }
const kinds = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
function make(v) {
  let res = null;
  const p = new Promise((r) => { res = r; });
  return { p, settle: () => res(v) };
}
async function main() {
  const cells = [make(1.5), make(true), make("str"), make(undefined), make(null), make(new Cyc()), make([1, 2, 3]), make(named)];
  /** @type {Promise<string>[]} */
  const waits = [];
  for (let i = 0; i < cells.length; i++) waits.push(cells[i].p.then((v) => kinds(v)));
  for (let i = cells.length - 1; i >= 0; i--) cells[i].settle();
  const names = await Promise.all(waits);
  console.log(names.join(","));
  const vals = [];
  for (let i = 0; i < cells.length; i++) vals.push(await cells[i].p);
  console.log(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5].self === vals[5], vals[6].length, vals[7]());
  /** @type {Promise<string>[]} */
  const two = [];
  two.push(cells[1].p.then((v) => kinds(v)));
  two.push(cells[2].p.then((v) => kinds(v)));
  const pair = await Promise.all(two);
  console.log(pair.join("/"));
  // adoption through async returns and nested promises
  const nested = async () => Promise.resolve(new Promise((res) => setTimeout(() => res({ deep: true }), 1)));
  const got = await nested();
  console.log(got.deep, await (async () => await cells[2].p)());
  // many pending dynamic promises with parked waiters
  const pend = [];
  for (let i = 0; i < 300; i++) pend.push(make(i % 2 ? i : "x".repeat(i % 5)));
  let acc = 0;
  /** @type {Promise<void>[]} */
  const readers = [];
  for (let i = 0; i < 300; i++) readers.push(pend[i].p.then((v) => { acc += typeof v === "number" ? v : v.length; }));
  for (let i = 0; i < 300; i++) pend[(i * 7) % 300].settle();
  await Promise.all(readers);
  console.log("acc", acc);
  // rejections of every kind
  const seen = [];
  const whys = [1, false, "s", null, undefined, { c: 1 }, new RangeError("r")];
  for (let i = 0; i < whys.length; i++) {
    try { await new Promise((res, rej) => rej(whys[i])); } catch (e) { seen.push(kinds(e) + (e instanceof Error ? ":" + e.message : "")); }
  }
  console.log(seen.join("|"));
  // left pending at exit: combinators over a promise that never settles, and one with a parked waiter
  const never = new Promise(() => {});
  const stuckAll = Promise.all([never, never]);
  void stuckAll;
  Promise.race([never]).then(() => console.log("unreachable"));
  (async () => { await never; console.log("unreachable"); })();
  console.log("exit pending");
}
main();
