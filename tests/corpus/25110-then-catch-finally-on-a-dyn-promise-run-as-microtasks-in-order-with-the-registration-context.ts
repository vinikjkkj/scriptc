// .then/.catch/.finally on a dyn promise: the callbacks run as microtasks in registration order, interleaved exactly with awaits and plain promise jobs;
// a throwing callback rejects the derived promise, a returned promise is adopted, and a callback sees the AsyncLocalStorage context of its REGISTRATION.
// Each reaction used to hold a fiber stack while parked; it is a stackless continuation now, and every tick count must stay what it was.
import { AsyncLocalStorage } from "node:async_hooks";
// then/catch/finally on a dyn promise: callbacks run as microtasks in registration order, interleaved exactly with awaits and plain promise jobs.
const log: string[] = [];
const note = (s: string): void => { log.push(s); };
function dynP(v: unknown): any { return Promise.resolve(v) as any; }
function dynR(e: unknown): any { return Promise.reject(e) as any; }
async function main(): Promise<void> {
  // ordering against awaits and plain jobs
  const a: any = dynP(1);
  a.then((v: number) => { note("then1:" + v); return v + 1; })
    .then((v: number) => { note("then2:" + v); });
  Promise.resolve().then(() => note("plain1"));
  a.then((v: number) => note("then3:" + v));
  (async () => { await a; note("await-after-a"); })();
  note("sync-end");
  await dynP(0);
  note("main-resumed");
  // rejection routes
  const r: any = dynR(new Error("boom"));
  r.then((v: unknown) => note("never:" + v), (e: Error) => { note("onr:" + e.message); return "recovered"; })
    .then((v: string) => note("after-onr:" + v));
  r.catch((e: Error) => note("catch:" + e.message));
  // a throwing callback rejects the derived promise
  dynP(5).then((v: number) => { throw new Error("cb-threw:" + v); }).catch((e: Error) => note("caught:" + e.message));
  // a returned promise is adopted (resolve walk), plain and dyn, fulfilled and rejected
  dynP(1).then(() => dynP("inner")).then((v: string) => note("adopted:" + v));
  dynP(1).then(() => dynR(new Error("inner-rej"))).catch((e: Error) => note("adopted-rej:" + e.message));
  dynP(1).then(() => new Promise<string>((res) => setTimeout(() => res("late"), 5))).then((v: string) => note("adopted-late:" + v));
  // a callback that is an async function
  // the callback sees the AsyncLocalStorage context captured when it was registered, not the one active when it runs
  const als = new AsyncLocalStorage<string>();
  als.run("ctx-A", () => { dynP(1).then(() => { note("als-then:" + String(als.getStore())); }); });
  als.run("ctx-B", () => { dynR(new Error("x")).catch(() => { note("als-catch:" + String(als.getStore())); }); });
  als.run("ctx-C", () => { dynP(1).then(() => dynP(2)).then(() => { note("als-adopted:" + String(als.getStore())); }); });
  note("als-outside:" + String(als.getStore()));
  // chains settle in a stable order against each other
  for (let i = 0; i < 3; i++) dynP(i).then((v: number) => note("loop:" + v)).then(() => note("loop-next:" + i));
  await new Promise<void>((res) => setTimeout(res, 30));
  note("async-result:" + (await dynP(2).then(async (v: number) => { await null; note("async-cb:" + v); return v * 2; })));
  // finally: each step awaited, so only the values (not the extra jobs Node's finally machinery adds) are compared
  const f: any = dynP("x");
  note("finally-pass:" + (await f.finally(() => note("finally-ok"))));
  try { await dynR("why").finally(() => note("finally-rej")); } catch (e: any) { note("finally-rethrown:" + e); }
  console.log(log.join("\n"));
}
main();
