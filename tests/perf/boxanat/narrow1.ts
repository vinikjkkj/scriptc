// A slot that is declared `unknown` and never used dynamically: written from
// one static type, read back with a cast to that same type. This is the
// zapo shape narrowcensus.mjs is looking for (WaMexResponse.data,
// PromiseDedup.inFlight, BoundedTaskQueue.task, and the 101 SQL row fields).
interface Payload { id: string; n: number; }
interface Envelope { tag: string; data: unknown; }

function wrap(p: Payload): Envelope {
  return { tag: "p", data: p };
}
function unwrap(e: Envelope): Payload {
  return e.data as Payload;
}

const e = wrap({ id: "a", n: 1 });
console.log(unwrap(e).id + " " + String(unwrap(e).n));
