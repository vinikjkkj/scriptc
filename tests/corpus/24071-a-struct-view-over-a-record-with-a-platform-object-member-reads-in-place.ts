// A record with an AbortSignal member narrowed to a smaller record: reads of every member, present and absent, are the source's own slots.
interface Wide { url: string; signal?: AbortSignal; extra: number }
interface Narrow { url: string; signal?: AbortSignal }
function pick(n: Narrow): string { const s = n.signal; return n.url + (s ? "S" : "-") + (n.signal?.aborted ? "A" : "n"); }
const ac = new AbortController();
const w: Wide = { url: "u", signal: ac.signal, extra: 1 };
const w2: Wide = { url: "v", extra: 2 };
console.log(pick(w), pick(w2));
ac.abort();
console.log(pick(w), w.extra);
