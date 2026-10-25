// A fire-and-forget allSettled over an untyped array, consumed by a
// fulfillment handler that inspects the settled records: the handler sees the
// results array in input order, and a rejection is observed, not unhandled.
const reply = (tag: string, ms: number) =>
  new Promise<string>((resolve) => {
    setTimeout(() => {
      console.log("reply", tag);
      resolve(tag);
    }, ms);
  });

const failing = (ms: number) =>
  new Promise<string>((_resolve, reject) => {
    setTimeout(() => reject(new Error("refused")), ms);
  });

function intercept(connections: any): void {
  const replies = connections.map((c: any) => c.ask());
  Promise.allSettled(replies).then((results) => {
    let rejected = 0;
    for (const result of results) {
      if (result.status === "rejected") {
        rejected++;
      }
    }
    console.log("settled", results.length, "rejected", rejected);
  });
}

const conns = [
  { ask: () => reply("one", 40) },
  { ask: () => failing(10) },
  { ask: () => reply("two", 20) },
];

intercept(conns);
console.log("intercepted");
setTimeout(() => console.log("tick"), 100);
