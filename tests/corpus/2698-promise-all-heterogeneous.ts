// `Promise.all([a(), b(), c()])` where the entries carry DIFFERENT payloads:
// the checker's tuple overload types the literal as a tuple of promises and
// the result as a tuple of their payloads.
//
// Awaiting the entries in sequence would build the same tuple and get the
// REJECTION wrong -- Promise.all rejects with whichever entry rejected first
// in TIME, a sequence with whichever rejects first in POSITION. The last
// case here is exactly that: position 0 rejects at 30ms, position 1 at 5ms,
// and the answer has to be the 5ms one.
//
// So the existing homogeneous combinator runs unchanged over a uniform
// array: every payload widens into ONE union (the flattened arms of all of
// them -- three of these four carry `null`, so the arms overlap and have to
// dedupe), and each position narrows back out of it, with the arms it
// cannot hold marked trappable. tsc proved position i's type when it chose
// the overload, which is what makes that narrowing honest.

type Reg = { readonly id: number };
type PK = { readonly key: string };
async function getReg(ok: boolean): Promise<Reg | null> { return ok ? { id: 7 } : null; }
async function getPK(ok: boolean): Promise<PK | null> { return ok ? { key: "k" } : null; }
async function hasKeys(): Promise<boolean> { return true; }
async function rotTs(ok: boolean): Promise<number | null> { return ok ? 1234 : null; }

async function main(): Promise<void> {
  const [reg, pk, has, ts] = await Promise.all([getReg(true), getPK(true), hasKeys(), rotTs(true)]);
  console.log(reg?.id, pk?.key, has, ts);
  const [reg2, pk2, has2, ts2] = await Promise.all([getReg(false), getPK(false), hasKeys(), rotTs(false)]);
  console.log(reg2, pk2, has2, ts2);
  // rejeicao: a primeira NO TEMPO
  const slow = async (): Promise<Reg> => { await new Promise((r) => setTimeout(r, 30)); throw new Error("slow"); };
  const fast = async (): Promise<PK> => { await new Promise((r) => setTimeout(r, 5)); throw new Error("fast"); };
  try { await Promise.all([slow(), fast()]); } catch (e) { console.log("rejeitou com:", e instanceof Error ? e.message : "?"); }
}
void main();
