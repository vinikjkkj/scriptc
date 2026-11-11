// A heterogeneous Promise.all tuple over promises whose payload types differ claims each source (one adapter per source), and a claim settles INSIDE the source's
// callback list. That list stayed attached to the source while its entries were consumed: each consumed entry's references were already released, and a release
// inside the loop can run the cycle collector, whose trace visited the stale entries and subtracted edges nothing held, so a record a tuple slot still owned was
// freed (heap-use-after-free under --sanitize, a leaked-object RC audit failure otherwise). Many concurrent decryptors hold the tuple's cycle-headered records
// across two awaits while cycle-creating work runs between them.
interface KeyPair { pub: Uint8Array; priv: Uint8Array }
interface Local { regId: number; keyPair: KeyPair; tag: string; self: Local | null; peer: Signed | null }
interface Signed { keyId: number; keyPair: KeyPair; sig: Uint8Array; owner: Local | null }
interface OneTime { keyId: number; keyPair: KeyPair }
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function loadLocal(n: number): Promise<Local> {
  await wait(n % 3);
  return { regId: n, keyPair: { pub: new Uint8Array(32).fill(n & 255), priv: new Uint8Array(32).fill((n + 1) & 255) }, tag: "local" + n, self: null, peer: null };
}
async function loadSigned(n: number): Promise<Signed> {
  await wait((n + 1) % 3);
  return { keyId: n * 2, keyPair: { pub: new Uint8Array(32).fill(1), priv: new Uint8Array(32).fill(2) }, sig: new Uint8Array(64).fill(3), owner: null };
}
async function loadOneTime(n: number): Promise<OneTime> {
  await wait((n + 2) % 3);
  return { keyId: n * 2 + 1, keyPair: { pub: new Uint8Array(32).fill(4), priv: new Uint8Array(32).fill(5) } };
}
class Node2 { next: Node2 | null = null; v = 0 }
function churn(n: number): number {
  let s = 0;
  for (let i = 0; i < 40; i++) {
    const a = new Node2(); const b = new Node2(); a.next = b; b.next = a; a.v = i + n; b.v = i; s += a.v + b.v;
  }
  return s;
}
async function decrypt(n: number): Promise<number> {
  const t = await Promise.all([loadLocal(n), loadSigned(n)]);
  const local = t[0]; const signed = t[1];
  local.self = local;
  await wait(n % 2);
  churn(n);
  let acc = local.regId + local.keyPair.pub[0]! + signed.keyId + signed.keyPair.priv[1]! + local.tag.length;
  await wait(1);
  churn(n + 1);
  acc += local.keyPair.priv[0]! + signed.sig[2]!;
  return acc;
}
async function main(): Promise<void> {
  let total = 0;
  for (let round = 0; round < 6; round++) {
    const results = await Promise.all(Array.from({ length: 1000 }, (_, i) => decrypt(round * 1000 + i)));
    for (const r of results) total += r;
  }
  console.log("total", total);
}
main();
