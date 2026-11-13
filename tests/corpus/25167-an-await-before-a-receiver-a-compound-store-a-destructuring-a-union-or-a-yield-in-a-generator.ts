// Awaits and yields in expression and header positions: receivers, compound and indexed stores, destructuring, closures, promise-or-absent
// unions (one and two unit arms), values live across parks, and generators and async generators. Every shape is its own function; the program
// prints one line per shape and Node is the oracle.
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
function* g_yield_arg(): Generator<number, void, number> { const a = yield 1; const b = (yield 2) + 1; yield add(a, yield 3); yield b; }
function* g_yield_cond(): Generator<number, number, boolean> { let n = 0; while (yield n) n++; return n; }
function* g_forof_yield(): Generator<number, number, number[]> { let t = 0; for (const x of yield 0) t += x; return t; }
function* g_throw_yield(): Generator<number, string, number> { try { throw yield 1; } catch (e) { return "c" + String(e); } }
function* g_args(): Generator<number, number, number> { return add(yield 1, yield 2); }
function* g_tern(): Generator<number, number, number> { const x = yield 0; return x > 0 ? yield 1 : yield 2; }
async function* ag_ya(): AsyncGenerator<number> { yield await v(1); yield (await v(2)) + 1; const r = add(1, await v(2)); yield r; }
async function* ag_lc(): AsyncGenerator<number> { let i = 0; while (await f(i < 3)) { yield i; i++; } }
async function* ag_fi(): AsyncGenerator<number> { for (const x of await ar()) yield x * 2; }
async function* ag_tw(): AsyncGenerator<number> { yield 1; throw await v(5); }
async function* ag_in(): AsyncGenerator<number> { yield await v(1); yield await v(2); }
async function* ag_out(): AsyncGenerator<number> { yield 0; yield* ag_in(); yield await v(3); }
async function* ag_in2(): AsyncGenerator<number> { yield 1; yield 2; }
async function* ag_out2(): AsyncGenerator<number> { for await (const x of ag_in2()) yield x + (await v(10)); }
async function* ag_cb(): AsyncGenerator<number> { yield 1; yield 2; yield 3; }
async function* ag_ia(): AsyncGenerator<number> { yield 4; yield 5; }
async function mk_ia(): Promise<AsyncGenerator<number>> { await tick(); return ag_ia(); }
async function* ag_ye(): AsyncGenerator<number, void, number> { const a = yield 1; const b = add(a, yield 2); yield b; }
async function s_method_recv(): Promise<string> {
  return String((await mkBox(3)).plain(2));
}
async function s_method_chain(): Promise<string> {
  return String((await (await mkBox(1)).self()).plain(5));
}
async function s_new_arg(): Promise<string> {
  return String(new Box(await v(4)).n);
}
async function s_method_arg(): Promise<string> {
  const b = new Box(1); return String(b.plain(await v(3)));
}
async function s_method_async_arg(): Promise<string> {
  const b = new Box(1); return String(await b.bump(await v(2)));
}
async function s_compound_local(): Promise<string> {
  let x = 1; x += await v(2); x *= await v(3); return String(x);
}
async function s_compound_field(): Promise<string> {
  const b = new Box(1); b.n += await v(2); return String(b.n);
}
async function s_compound_index(): Promise<string> {
  const a = [1, 2, 3]; a[1] += await v(5); return String(a[1]);
}
async function s_compound_str(): Promise<string> {
  let r = "a"; r += await s("b"); r += "c"; return r;
}
async function s_index_await(): Promise<string> {
  const a = [10, 20, 30]; return String(a[await v(1)]);
}
async function s_index_assign_both(): Promise<string> {
  const a = [0, 0, 0]; a[await v(1)] = await v(7); return String(a[1]);
}
async function s_index_assign_value(): Promise<string> {
  const a = [0, 0, 0]; a[1] = add(2, await v(7)); return String(a[1]);
}
async function s_field_assign_await(): Promise<string> {
  const b = new Box(0); b.n = await v(6); return String(b.n);
}
async function s_field_assign_after_call(): Promise<string> {
  const b = new Box(0); b.n = add(1, await v(6)); return String(b.n);
}
async function s_opt_chain_arg(): Promise<string> {
  const b: Box | null = new Box(2); return String(b?.plain(await v(3)));
}
async function s_closure_arg(): Promise<string> {
  const g = (n: number): number => n + 1; return String(g(await v(1)));
}
async function s_closure_capture_mutated(): Promise<string> {
  let c = 0; const inc = (): void => { c++; }; inc(); await tick(); inc(); return String(c);
}
async function s_async_arrow(): Promise<string> {
  const g = async (n: number): Promise<number> => (await v(n)) + 1; return String(await g(2));
}
async function s_async_closure_captures(): Promise<string> {
  let t = 0; const g = async (): Promise<void> => { t += await v(3); }; await g(); await g(); return String(t);
}
async function s_destructure_obj(): Promise<string> {
  const { a, b } = await mkP(); return String(a + b);
}
async function s_destructure_arr(): Promise<string> {
  const [x, y] = await ar(); return String(x + y);
}
async function s_destructure_default_await(): Promise<string> {
  const o = {} as { a?: number }; const { a = await v(1) } = o; return String(a);
}
async function s_destructure_assign(): Promise<string> {
  let a = 0; let b = 0; ({ a, b } = await mkP()); return String(a + b);
}
async function s_union_one_unit_arm(): Promise<string> {
  const p: Promise<number> | undefined = (await f(true)) ? v(3) : undefined; const r = await p; return String(r);
}
async function s_union_one_unit_arm_absent(): Promise<string> {
  const p: Promise<number> | undefined = (await f(false)) ? v(3) : undefined; const r = await p; return String(r);
}
async function s_union_two_unit_arms(): Promise<string> {
  const k = await v(1); const p: Promise<number> | undefined | null = k === 1 ? v(3) : k === 2 ? undefined : null; const r = await p; return String(r);
}
async function s_union_two_unit_arms_null(): Promise<string> {
  const k = await v(3); const p: Promise<number> | undefined | null = k === 1 ? v(3) : k === 2 ? undefined : null; const r = await p; return String(r);
}
async function s_union_void(): Promise<string> {
  const p: Promise<void> | undefined = (await f(true)) ? tick() : undefined; await p; return "ok";
}
async function s_promise_all_in_expr(): Promise<string> {
  const ps: Promise<number>[] = [v(1), v(2)]; return String(add((await Promise.all(ps))[0], await v(5)));
}
async function s_live_across_two_awaits(): Promise<string> {
  const a = "A" + (await s("x")); const b = a + (await s("y")); return a + b;
}
async function s_many_locals_across(): Promise<string> {
  const a = await v(1); const b = await v(2); const c = await v(3); const d = await v(4); const e = a + b + c + d; return String(e + (await v(e)));
}
async function s_bool_and_f64_across(): Promise<string> {
  const flag = await f(true); const n = await v(4); const m = (flag ? n : 0) + (await v(1)); return String(m);
}
async function s_string_across_ternary(): Promise<string> {
  const t = await f(true); const r = (t ? "yes" : "no") + (await s("!")); return r;
}
async function s_gen_yield_arg(): Promise<string> {
  const it = g_yield_arg(); const out: number[] = []; let r = it.next(0); out.push(r.value as number); r = it.next(10); out.push(r.value as number); r = it.next(20); out.push(r.value as number); r = it.next(30); out.push(r.value as number); r = it.next(0); out.push(r.value as number); return out.length + ":" + out[0] + out[1] + out[2] + out[3] + out[4];
}
async function s_gen_yield_cond(): Promise<string> {
  const it = g_yield_cond(); it.next(true); it.next(true); it.next(true); const r = it.next(false); return String(r.value);
}
async function s_gen_forof_yield(): Promise<string> {
  const it = g_forof_yield(); it.next([]); const r = it.next([1, 2, 3]); return String(r.value);
}
async function s_gen_throw_yield(): Promise<string> {
  const it = g_throw_yield(); it.next(0); const r = it.next(9); return String(r.value);
}
async function s_gen_yield_in_args(): Promise<string> {
  const it = g_args(); it.next(0); it.next(5); const r = it.next(6); return String(r.value);
}
async function s_gen_yield_ternary(): Promise<string> {
  const it = g_tern(); it.next(0); it.next(1); const r = it.next(42); return String(r.value);
}
async function s_agen_yield_await(): Promise<string> {
  let t = 0; for await (const x of ag_ya()) t = t * 10 + x; return String(t);
}
async function s_agen_loop_cond(): Promise<string> {
  let t = 0; for await (const x of ag_lc()) t += x; return String(t);
}
async function s_agen_forof_iter_await(): Promise<string> {
  let t = 0; for await (const x of ag_fi()) t += x; return String(t);
}
async function s_agen_throw_await(): Promise<string> {
  let t = 0; try { for await (const x of ag_tw()) t += x; } catch (e) { t += 100 + Number(e); } return String(t);
}
async function s_agen_delegate(): Promise<string> {
  let t = ""; for await (const x of ag_out()) t += x; return t;
}
async function s_agen_for_await_in_agen(): Promise<string> {
  let t = 0; for await (const x of ag_out2()) t += x; return String(t);
}
async function s_for_await_cond_body(): Promise<string> {
  let t = 0; for await (const x of ag_cb()) { if (await f(x === 2)) continue; t += x; } return String(t);
}
async function s_for_await_iterable_await(): Promise<string> {
  let t = 0; for await (const x of await mk_ia()) t += x; return String(t);
}
async function s_agen_yield_in_expr(): Promise<string> {
  const it = ag_ye(); const out: number[] = []; let r = await it.next(0); out.push(r.value as number); r = await it.next(3); out.push(r.value as number); r = await it.next(4); out.push(r.value as number); return out.join(","); 
}
async function main(): Promise<void> {
  console.log("method_recv", await s_method_recv());
  console.log("method_chain", await s_method_chain());
  console.log("new_arg", await s_new_arg());
  console.log("method_arg", await s_method_arg());
  console.log("method_async_arg", await s_method_async_arg());
  console.log("compound_local", await s_compound_local());
  console.log("compound_field", await s_compound_field());
  console.log("compound_index", await s_compound_index());
  console.log("compound_str", await s_compound_str());
  console.log("index_await", await s_index_await());
  console.log("index_assign_both", await s_index_assign_both());
  console.log("index_assign_value", await s_index_assign_value());
  console.log("field_assign_await", await s_field_assign_await());
  console.log("field_assign_after_call", await s_field_assign_after_call());
  console.log("opt_chain_arg", await s_opt_chain_arg());
  console.log("closure_arg", await s_closure_arg());
  console.log("closure_capture_mutated", await s_closure_capture_mutated());
  console.log("async_arrow", await s_async_arrow());
  console.log("async_closure_captures", await s_async_closure_captures());
  console.log("destructure_obj", await s_destructure_obj());
  console.log("destructure_arr", await s_destructure_arr());
  console.log("destructure_default_await", await s_destructure_default_await());
  console.log("destructure_assign", await s_destructure_assign());
  console.log("union_one_unit_arm", await s_union_one_unit_arm());
  console.log("union_one_unit_arm_absent", await s_union_one_unit_arm_absent());
  console.log("union_two_unit_arms", await s_union_two_unit_arms());
  console.log("union_two_unit_arms_null", await s_union_two_unit_arms_null());
  console.log("union_void", await s_union_void());
  console.log("promise_all_in_expr", await s_promise_all_in_expr());
  console.log("live_across_two_awaits", await s_live_across_two_awaits());
  console.log("many_locals_across", await s_many_locals_across());
  console.log("bool_and_f64_across", await s_bool_and_f64_across());
  console.log("string_across_ternary", await s_string_across_ternary());
  console.log("gen_yield_arg", await s_gen_yield_arg());
  console.log("gen_yield_cond", await s_gen_yield_cond());
  console.log("gen_forof_yield", await s_gen_forof_yield());
  console.log("gen_throw_yield", await s_gen_throw_yield());
  console.log("gen_yield_in_args", await s_gen_yield_in_args());
  console.log("gen_yield_ternary", await s_gen_yield_ternary());
  console.log("agen_yield_await", await s_agen_yield_await());
  console.log("agen_loop_cond", await s_agen_loop_cond());
  console.log("agen_forof_iter_await", await s_agen_forof_iter_await());
  console.log("agen_throw_await", await s_agen_throw_await());
  console.log("agen_delegate", await s_agen_delegate());
  console.log("agen_for_await_in_agen", await s_agen_for_await_in_agen());
  console.log("for_await_cond_body", await s_for_await_cond_body());
  console.log("for_await_iterable_await", await s_for_await_iterable_await());
  console.log("agen_yield_in_expr", await s_agen_yield_in_expr());
}
main();
