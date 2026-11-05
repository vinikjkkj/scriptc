// A declaration-claimed Promise<T> over a promise made by untyped JavaScript is the SAME promise in Node, so its
// observers run exactly where they would on the JavaScript promise. `t` counts microtask turns (one `await null`
// each); every observer logs the turn it ran on, next to a plain JavaScript reaction queued at the same moment.
import { fulfilled, rejected, settled, timer, again } from "twinrec/claim";
let t = 0;
const log: string[] = [];
const note = (s: string): void => {
  log.push(s + "@" + t);
};
async function ticker(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await null;
    t++;
  }
}
async function main(): Promise<void> {
  const tk = ticker();
  const ful = fulfilled(1);
  ful.then((v) => note("then-fulfilled " + v));
  Promise.resolve().then(() => note("plain-1"));
  const rej = rejected("boom");
  rej.then(
    () => note("rej-resolved"),
    (e: unknown) => note("then-rejected " + (e as Error).message),
  );
  const set = settled(3);
  set.then((v) => note("then-settled " + v));
  Promise.resolve().then(() => note("plain-2"));
  const tim = timer(4);
  tim.then((v) => note("then-timer " + v));
  const mid = again(fulfilled(5));
  const two = again(mid);
  two.then((v) => note("then-two " + v));
  note("sync");
  const a = await ful;
  note("await-fulfilled " + a);
  try {
    await rej;
  } catch (e) {
    note("await-rejected " + (e as Error).message);
  }
  const b = await set;
  note("await-settled " + b);
  const c = await two;
  note("await-two " + c);
  const d = await tim;
  note("await-timer " + d);
  await tk;
  console.log(log.join("\n"));
}
void main();
