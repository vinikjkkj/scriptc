// The resolve and reject functions of `new Promise((resolve, reject) => ...)` share one "already settled" state through the promise, and each
// one keeps its promise alive for as long as the function itself is held. Settlement order, double settlement, adopting another promise and
// resolvers kept long after the promise's last other reference are checked against Node. (Resolving a promise with ITSELF is not in this
// row: main throws a TypeError for it that the awaiter never sees, a separate defect recorded in docs/sonnet-queue.md.)
const log: string[] = [];
const say = (s: string): void => {
  log.push(s);
};

async function settle<T>(label: string, p: Promise<T>): Promise<void> {
  try {
    say(label + " ok " + String(await p));
  } catch (e) {
    say(label + " err " + String(e instanceof Error ? e.message : e));
  }
}

async function main(): Promise<void> {
  await settle("resolve-after-reject", new Promise<number>((resolve, reject) => { reject(new Error("first")); resolve(1); }));
  await settle("reject-after-resolve", new Promise<number>((resolve, reject) => { resolve(2); reject(new Error("late")); }));
  await settle("double-resolve", new Promise<number>((resolve) => { resolve(3); resolve(4); }));
  await settle("double-reject", new Promise<number>((_r, reject) => { reject(new Error("a")); reject(new Error("b")); }));
  await settle("reject-unknown", new Promise<number>((_r, reject) => { reject("plain text"); }));

  // Adopting another promise: fulfilled, rejected, and one that settles later.
  const inner = Promise.resolve(10);
  await settle("adopt-fulfilled", new Promise<number>((resolve) => { resolve(inner); }));
  const bad: Promise<number> = Promise.reject(new Error("inner failed"));
  bad.catch(() => undefined);
  await settle("adopt-rejected", new Promise<number>((resolve) => { resolve(bad); }));
  let later: (v: number) => void = () => undefined;
  const slow = new Promise<number>((res) => { later = res; });
  const adopting = new Promise<number>((resolve) => { resolve(slow); });
  later(11);
  await settle("adopt-later", adopting);

  // Resolvers kept in an array while every other reference to their promises is dropped, settled in a different order.
  const resolvers: ((v: number) => void)[] = [];
  const rejecters: ((e: Error) => void)[] = [];
  const watchers: Promise<void>[] = [];
  for (let i = 0; i < 400; i++) {
    const p = new Promise<number>((resolve, reject) => { resolvers.push(resolve); rejecters.push(reject); });
    watchers.push(settle("kept" + i, p));
  }
  for (let i = 399; i >= 0; i--) {
    if (i % 3 === 0) rejecters[i](new Error("r" + i)); else resolvers[i](i * 2);
    if (i % 5 === 0) { resolvers[i](-1); rejecters[i](new Error("late" + i)); }
  }
  await Promise.all(watchers);
  let sum = 0;
  for (const l of log) {
    if (l.startsWith("kept")) for (let k = 0; k < l.length; k++) sum = (sum * 31 + l.charCodeAt(k)) >>> 0;
  }
  console.log("kept-checksum", sum, log.filter((l) => l.startsWith("kept")).length);

  // A resolver that only the promise's own callback chain holds: the promise is unreachable except through the closure it is stored in.
  let holder: ((v: string) => void) | null = null;
  const chain = new Promise<string>((resolve) => { holder = resolve; }).then((v) => v + "!");
  const h = holder as ((v: string) => void) | null;
  if (h !== null) h("held");
  say("chain " + (await chain));

  for (const l of log) if (!l.startsWith("kept")) console.log(l);
}

main();
