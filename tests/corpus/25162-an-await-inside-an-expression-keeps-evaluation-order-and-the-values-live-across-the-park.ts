// Awaits inside expressions: call arguments, operators, ternary branches, short-circuit, templates, literals, spreads.
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
async function s_call_arg_after(): Promise<string> {
  return String(add(1, await v(2)));
}
async function s_call_arg_before(): Promise<string> {
  return String(add(await v(1), 2));
}
async function s_call_two_awaits(): Promise<string> {
  return String(add(await v(1), await v(2)));
}
async function s_call_nested(): Promise<string> {
  return String(add(add(1, await v(2)), await v(3)));
}
async function s_call_variadic(): Promise<string> {
  return String(sum(1, await v(2), 3, await v(4)));
}
async function s_binary_mix(): Promise<string> {
  return String((await v(1)) + (await v(2)) * 3 - 1);
}
async function s_binary_left_operand_live(): Promise<string> {
  const a = await v(10); const b = a * (await v(2)) + a; return String(b);
}
async function s_ternary_then(): Promise<string> {
  const x = true; return String(x ? await v(1) : 2);
}
async function s_ternary_else(): Promise<string> {
  const x = false; return String(x ? 1 : await v(2));
}
async function s_ternary_both(): Promise<string> {
  const x = true; return String(x ? await v(1) : await v(2));
}
async function s_ternary_cond(): Promise<string> {
  return String((await f(true)) ? 1 : 2);
}
async function s_ternary_nested(): Promise<string> {
  const x = 1; return String(x === 1 ? (x < 2 ? await v(7) : 8) : await v(9));
}
async function s_and_bool(): Promise<string> {
  const a = true; return String(a && (await f(false)));
}
async function s_or_bool(): Promise<string> {
  const a = false; return String(a || (await f(true)));
}
async function s_nullish(): Promise<string> {
  const n: number | null = null; return String(n ?? (await v(9)));
}
async function s_and_in_condition(): Promise<string> {
  let t = 0; for (let i = 0; i < 3; i++) { if (i > 0 && (await f(i === 2))) t++; } return String(t);
}
async function s_template(): Promise<string> {
  return `${await v(1)}-${await v(2)}`;
}
async function s_obj_literal(): Promise<string> {
  const o = { a: await v(1), b: 2, c: await v(3) }; return String(o.a + o.b + o.c);
}
async function s_arr_literal(): Promise<string> {
  const a = [await v(1), 2, await v(3)]; return String(a.length) + String(a[2]);
}
async function s_nested_awaits(): Promise<string> {
  return String(add(await v(await v(1)), await v(2)));
}
async function s_unary_not(): Promise<string> {
  return String(!(await f(false)));
}
async function s_unary_neg(): Promise<string> {
  return String(-(await v(3)));
}
async function s_unary_typeof(): Promise<string> {
  return typeof (await v(1));
}
async function s_str_concat(): Promise<string> {
  let r = "a"; r = r + (await s("b")) + "c" + (await s("d")); return r;
}
async function s_compare_awaits(): Promise<string> {
  return String((await v(1)) < (await v(2)));
}
async function s_await_non_promise(): Promise<string> {
  return String((await 5) + (await 6));
}
async function s_number_conv(): Promise<string> {
  return String(Number(await s("5")) + 1);
}
async function s_string_method_arg(): Promise<string> {
  return String("abc".indexOf(await s("c")));
}
async function s_array_push_two(): Promise<string> {
  const a: number[] = []; a.push(await v(1), await v(2)); return String(a.length);
}
async function s_spread_arr(): Promise<string> {
  const a = [...(await ar()), 9]; return String(a.length);
}
async function s_spread_call(): Promise<string> {
  return String(sum(...(await ar()), await v(4)));
}
async function main(): Promise<void> {
  console.log("call_arg_after", await s_call_arg_after());
  console.log("call_arg_before", await s_call_arg_before());
  console.log("call_two_awaits", await s_call_two_awaits());
  console.log("call_nested", await s_call_nested());
  console.log("call_variadic", await s_call_variadic());
  console.log("binary_mix", await s_binary_mix());
  console.log("binary_left_operand_live", await s_binary_left_operand_live());
  console.log("ternary_then", await s_ternary_then());
  console.log("ternary_else", await s_ternary_else());
  console.log("ternary_both", await s_ternary_both());
  console.log("ternary_cond", await s_ternary_cond());
  console.log("ternary_nested", await s_ternary_nested());
  console.log("and_bool", await s_and_bool());
  console.log("or_bool", await s_or_bool());
  console.log("nullish", await s_nullish());
  console.log("and_in_condition", await s_and_in_condition());
  console.log("template", await s_template());
  console.log("obj_literal", await s_obj_literal());
  console.log("arr_literal", await s_arr_literal());
  console.log("nested_awaits", await s_nested_awaits());
  console.log("unary_not", await s_unary_not());
  console.log("unary_neg", await s_unary_neg());
  console.log("unary_typeof", await s_unary_typeof());
  console.log("str_concat", await s_str_concat());
  console.log("compare_awaits", await s_compare_awaits());
  console.log("await_non_promise", await s_await_non_promise());
  console.log("number_conv", await s_number_conv());
  console.log("string_method_arg", await s_string_method_arg());
  console.log("array_push_two", await s_array_push_two());
  console.log("spread_arr", await s_spread_arr());
  console.log("spread_call", await s_spread_call());
}
main();
