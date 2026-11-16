// The declared interface and the wide record a spread literal builds are one struct after the merge. Every enumeration surface of the
// DECLARED type must read the merged members: keys, entries, for-in, spread, JSON, console.log. (All values are strings so
// Object.entries stays inside what it supports.) `size` and `length` are declared and carried names a crossed accessor object reuses.
interface Commons { jid: string; size?: string; length?: string; tag?: string; note?: string }
interface Meta { readonly jid: string; readonly size?: string; readonly length?: string; readonly owner?: string }
function commons(a: Record<string, string | undefined>): Commons {
  return { jid: a['id'] ?? '', size: a['size'], length: a['len'], tag: a['tag'], note: a['note'] };
}
function meta(a: Record<string, string | undefined>): Meta {
  const c = commons(a);
  return { ...c, owner: a['creator'] };
}
function show(x: unknown): string { return JSON.stringify(x); }
const m = meta({ id: 'g1@g.us', size: '3', len: '7', tag: 'T', note: 'N', creator: 'u1' });
console.log(show(m));
console.log(Object.keys(m).join(','));
console.log(JSON.stringify(Object.entries(m)));
const seen: string[] = [];
for (const k in m) seen.push(k);
console.log(seen.join(','));
console.log(JSON.stringify({ ...m }));
console.log(m);
const acc = { get size(): number { return 3; }, get length(): number { return 9; }, k: 1 };
console.log(show(acc));
