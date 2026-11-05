// An async function that returns a value typed `unknown` resolves its own promise WITH it (ES PromiseResolve): a promise or a
// thenable is adopted, anything else fulfills at once. The order the settlements are observed in is the contract: the thenable
// job runs `then` one turn later, a native promise subscribes with it, and a plain value costs no turn.
const log: string[] = [];
const L = (s: string): void => {
  log.push(s);
};
const asDyn = (x: unknown): unknown => x;
const show = (v: unknown): string => (v instanceof Error ? "Error:" + v.message : JSON.stringify(v));
const tag = (n: string) => (v: unknown): void => L(n + ":" + show(v));

async function retPromise(): Promise<unknown> {
  return asDyn(Promise.resolve(5));
}
async function retPlain(): Promise<unknown> {
  return asDyn(7);
}
async function retThenable(): Promise<unknown> {
  return asDyn({ then(res: (v: number) => void) { L("then called"); res(9); } });
}
async function retRejected(): Promise<unknown> {
  return asDyn(Promise.reject(new Error("boom")));
}
async function retThenableThrows(): Promise<unknown> {
  return asDyn({ then() { throw new Error("tthrow"); } });
}
async function retThenableRejects(): Promise<unknown> {
  return asDyn({ then(_res: unknown, rej: (e: Error) => void) { rej(new Error("trej")); } });
}
async function retThenableTwice(): Promise<unknown> {
  return asDyn({ then(res: (v: number) => void) { res(1); res(2); } });
}
async function retNested(): Promise<unknown> {
  return asDyn({ then(res: (v: unknown) => void) { res(Promise.resolve("inner")); } });
}
async function retLater(): Promise<unknown> {
  return asDyn({ then(res: (v: string) => void) { setTimeout(() => res("later"), 5); } });
}
async function retArray(): Promise<unknown> {
  return asDyn([1, 2]);
}
async function retNull(): Promise<unknown> {
  return asDyn(null);
}
async function retPending(): Promise<unknown> {
  return asDyn(new Promise((r) => setTimeout(() => r("pending"), 3)));
}

retPromise().then(tag("promise"), tag("promise-rej"));
retPlain().then(tag("plain"), tag("plain-rej"));
retThenable().then(tag("thenable"), tag("thenable-rej"));
retRejected().then(tag("rejected"), tag("rejected-rej"));
retThenableThrows().then(tag("tthrow"), tag("tthrow-rej"));
retThenableRejects().then(tag("trej"), tag("trej-rej"));
retThenableTwice().then(tag("twice"), tag("twice-rej"));
retNested().then(tag("nested"), tag("nested-rej"));
retLater().then(tag("later"), tag("later-rej"));
retArray().then(tag("array"), tag("array-rej"));
retNull().then(tag("null"), tag("null-rej"));
retPending().then(tag("pending"), tag("pending-rej"));
(async () => {
  for (let i = 1; i <= 8; i++) {
    await null;
    L("t" + i);
  }
  await new Promise((r) => setTimeout(r, 30));
  console.log(log.join("\n"));
})();
