// The shape of a batched query: a union-typed parameter list padded with the same ("", "", -1) triple, handed to a dynamically typed consumer. The
// dynamic copy's -1, 0, 1 and "" are shared immortal nodes; the consumer must see exactly the values, in order, and anything it does with them
// (reading, printing, serialising, replacing a slot, appending) must not reach the shared nodes.
type P = string | number | boolean | null;
interface Addr { user: string; server: string; device: number }
const NO_MATCH: Addr = { user: "", server: "", device: -1 };
const held: unknown[] = [];
function consume(sql: string, params: unknown): number {
  held.push(params);
  return sql.length + JSON.stringify(params).length;
}
function batch(q: number): P[] {
  const addrs: Addr[] = [];
  for (let i = 0; i < 3; i++) addrs.push({ user: "u" + q + "_" + i, server: "s.whatsapp.net", device: i });
  while (addrs.length < 12) addrs.push(NO_MATCH);
  return ["session" + q, ...addrs.flatMap((t) => [t.user, t.server, t.device])];
}
let total = 0;
for (let q = 0; q < 200; q++) total += consume("SELECT", batch(q));
console.log(total, held.length);
console.log(JSON.stringify(held[0]));
console.log(JSON.stringify(held[199]));

// a booleans-and-nulls list and a list with -0 and NaN, which must not be shared with 0
const odd: P[] = [0, -0, NaN, 1, -1, true, false, null, "", " ", "0"];
console.log(JSON.stringify(odd), consume("ODD", odd));

// the dynamic copies are independent: held lists hold the same shared nodes, but each is its own array
const a = held[0] as unknown[];
const b = held[1] as unknown[];
console.log(a.length === b.length, a !== b);
