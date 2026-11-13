// Awaits in statement positions: throw, loop headers, for-of iterable, keyed stores, switch, labeled jumps, try/finally.
// Every shape is its own async function; the program prints one line per shape and Node is the oracle.
function tick(): Promise<void> { return new Promise<void>((r) => setTimeout(r, 0)); }
async function v(n: number): Promise<number> { await tick(); return n; }
async function s(x: string): Promise<string> { await Promise.resolve(); return x; }
async function f(b: boolean): Promise<boolean> { await tick(); return b; }
async function ar(): Promise<number[]> { await tick(); return [1, 2, 3]; }
function add(a: number, b: number): number { return a + b; }
function sum(...xs: number[]): number { let t = 0; for (const x of xs) t += x; return t; }
class Box {
  n: number;
  constructor(n: number) { this.n = n; }
  async bump(m: number): Promise<number> { await tick(); this.n += m; return this.n; }
  async self(): Promise<Box> { await tick(); return this; }
  plain(m: number): number { return this.n * m; }
}
async function mkBox(n: number): Promise<Box> { await tick(); return new Box(n); }
interface P { a: number; b: number; }
async function mkP(): Promise<P> { await tick(); return { a: 1, b: 2 }; }
async function s_throw_await(): Promise<string> {
  try { throw await v(7); } catch (e) { return "c" + String(e); } return "none";
}
async function s_throw_new_error_await(): Promise<string> {
  try { throw new Error("e" + (await v(3))); } catch (e) { return (e as Error).message; } return "none";
}
async function s_while_cond(): Promise<string> {
  let i = 0; let t = 0; while (await f(i < 3)) { t += i; i++; } return String(t);
}
async function s_dowhile_cond(): Promise<string> {
  let i = 0; let t = 0; do { i++; if (i === 2) continue; t += i; } while (await f(i < 4)); return String(t);
}
async function s_for_cond(): Promise<string> {
  let t = 0; for (let i = 0; await f(i < 3); i++) t += i; return String(t);
}
async function s_for_update(): Promise<string> {
  let t = 0; for (let i = 0; i < 6; i += await v(2)) t += i; return String(t);
}
async function s_for_init(): Promise<string> {
  let t = 0; for (let i = await v(1); i < 4; i++) t += i; return String(t);
}
async function s_for_all_three(): Promise<string> {
  let t = 0; for (let i = await v(0); await f(i < 3); i += await v(1)) t += i; return String(t);
}
async function s_forof_iter(): Promise<string> {
  let t = 0; for (const x of await ar()) t += x; return String(t);
}
async function s_forof_iter_literal(): Promise<string> {
  let t = 0; for (const x of [await v(1), await v(2)]) t += x; return String(t);
}
async function s_forof_body(): Promise<string> {
  let t = 0; for (const x of [1, 2, 3]) t += await v(x); return String(t);
}
async function s_forof_iter_and_body(): Promise<string> {
  let t = 0; for (const x of await ar()) { t += await v(x); } return String(t);
}
async function s_array_clear(): Promise<string> {
  const a: string[] = ["x", "y", "z"]; a[await v(1)] = null as unknown as string; return String(a.length);
}
async function s_record_key_set(): Promise<string> {
  const r: Record<string, number> = {}; r[await s("k")] = await v(5); r["j"] = await v(6); return String(r["k"] + r["j"]);
}
async function s_record_key_set_value_only(): Promise<string> {
  const r: Record<string, number> = {}; r["k"] = await v(5); return String(r["k"]);
}
async function s_record_key_delete(): Promise<string> {
  const r: Record<string, number> = { a: 1, b: 2 }; delete r[await s("a")]; return String(r["b"]);
}
async function s_switch_disc(): Promise<string> {
  switch (await v(2)) { case 1: return "one"; case 2: return "two"; default: return "d"; }
}
async function s_switch_case_test(): Promise<string> {
  const x = 2; switch (x) { case await v(1): return "one"; case await v(2): return "two"; default: return "d"; }
}
async function s_switch_body_await(): Promise<string> {
  switch (2) { case 2: { const q = await v(5); return "q" + q; } default: return "d"; }
}
async function s_if_cond(): Promise<string> {
  if (await f(true)) return "t"; return "f";
}
async function s_if_else_if(): Promise<string> {
  if (await f(false)) return "a"; else if (await f(true)) return "b"; return "c";
}
async function s_return_sum(): Promise<string> {
  return String((await v(1)) + (await v(2)));
}
async function s_return_in_try_finally(): Promise<string> {
  let log = ""; try { return "a" + (await v(1)); } finally { await tick(); log += "f"; }
}
async function s_catch_await(): Promise<string> {
  try { throw new Error("x"); } catch (e) { return "c" + (await v(4)); }
}
async function s_finally_await(): Promise<string> {
  let r = ""; try { r += "t"; } finally { r += String(await v(2)); } return r;
}
async function s_label_break(): Promise<string> {
  let t = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (await f(i + j === 3)) break outer; t++; } } return String(t);
}
async function s_label_continue(): Promise<string> {
  let t = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (await f(j === 1)) continue outer; t++; } } return String(t);
}
async function s_pending_containers_dead_after_the_await(): Promise<string> {
  const ds: { p: Promise<number>; ok: (n: number) => void }[] = []; const ps: Promise<number>[] = []; for (let i = 0; i < 5; i++) { let ok!: (n: number) => void; const p = new Promise<number>((a) => { ok = a; }); ds.push({ p, ok }); ps.push(p.then((x) => x + 1)); } for (let i = 0; i < 5; i++) ds[i].ok(i); let t = 0; for (const v of await Promise.all(ps)) t += v; return String(t);
}
async function s_pending_container_in_loop(): Promise<string> {
  let t = 0; for (let r = 0; r < 3; r++) { const ps: Promise<number>[] = []; for (let i = 0; i < 4; i++) ps.push(v(i + r)); const all = await Promise.all(ps); for (const x of all) t += x; } return String(t);
}
async function s_while_true_break(): Promise<string> {
  let i = 0; while (true) { i++; if (await f(i === 3)) break; } return String(i);
}
async function s_nested_loops_conds(): Promise<string> {
  let t = 0; for (let i = 0; await f(i < 2); i++) { let j = 0; while (await f(j < 2)) { j++; t++; } } return String(t);
}
async function s_await_in_loop_with_locals(): Promise<string> {
  let acc = ""; for (let i = 0; i < 3; i++) { const piece = "p" + i; acc += piece + (await s("-")); } return acc;
}
async function main(): Promise<void> {
  console.log("throw_await", await s_throw_await());
  console.log("throw_new_error_await", await s_throw_new_error_await());
  console.log("while_cond", await s_while_cond());
  console.log("dowhile_cond", await s_dowhile_cond());
  console.log("for_cond", await s_for_cond());
  console.log("for_update", await s_for_update());
  console.log("for_init", await s_for_init());
  console.log("for_all_three", await s_for_all_three());
  console.log("forof_iter", await s_forof_iter());
  console.log("forof_iter_literal", await s_forof_iter_literal());
  console.log("forof_body", await s_forof_body());
  console.log("forof_iter_and_body", await s_forof_iter_and_body());
  console.log("array_clear", await s_array_clear());
  console.log("record_key_set", await s_record_key_set());
  console.log("record_key_set_value_only", await s_record_key_set_value_only());
  console.log("record_key_delete", await s_record_key_delete());
  console.log("switch_disc", await s_switch_disc());
  console.log("switch_case_test", await s_switch_case_test());
  console.log("switch_body_await", await s_switch_body_await());
  console.log("if_cond", await s_if_cond());
  console.log("if_else_if", await s_if_else_if());
  console.log("return_sum", await s_return_sum());
  console.log("return_in_try_finally", await s_return_in_try_finally());
  console.log("catch_await", await s_catch_await());
  console.log("finally_await", await s_finally_await());
  console.log("label_break", await s_label_break());
  console.log("label_continue", await s_label_continue());
  console.log("pending_containers_dead_after_the_await", await s_pending_containers_dead_after_the_await());
  console.log("pending_container_in_loop", await s_pending_container_in_loop());
  console.log("while_true_break", await s_while_true_break());
  console.log("nested_loops_conds", await s_nested_loops_conds());
  console.log("await_in_loop_with_locals", await s_await_in_loop_with_locals());
}
main();
