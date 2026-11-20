// dns.lookup runs getaddrinfo on libuv's threadpool in Node, so concurrent
// lookups overlap and each completion is its own MakeCallback scope. Pinned,
// independent of resolver timing or completion order: 40 concurrent lookups
// of "localhost" and 10 of a name that cannot exist (the reserved .invalid
// TLD, RFC 2606) all deliver exactly once, none before the synchronous run,
// the nextTick queue and the promise jobs, each with its own checkpoint
// ((cb tick micro)*), the successes with a null error and a family of 4 or 6,
// the failures with ENOTFOUND and the message getaddrinfo ENOTFOUND <name>.
import * as dns from "node:dns";

const log: string[] = [];
let ok = 0;
let notFound = 0;
let families = 0;
let messages = 0;
let delivered = 0;
const TOTAL = 50;
let finish: () => void = () => {};

function checkpoint(): void {
  delivered++;
  log.push("cb");
  process.nextTick(() => log.push("tick"));
  Promise.resolve().then(() => log.push("micro"));
  if (delivered === TOTAL) setTimeout(finish, 0);
}

for (let i = 0; i < 40; i++) {
  dns.lookup("localhost", (err, addr, fam) => {
    if (err === null) ok++;
    if (typeof addr === "string" && addr.length > 0 && (fam === 4 || fam === 6)) families++;
    checkpoint();
  });
}
for (let i = 0; i < 10; i++) {
  dns.lookup("scriptc-no-such-host.invalid", (err, addr) => {
    if (err !== null && (err as Error & { code?: string }).code === "ENOTFOUND") notFound++;
    if (err !== null && err.message === "getaddrinfo ENOTFOUND scriptc-no-such-host.invalid") messages++;
    if (addr === undefined) families += 1000;
    checkpoint();
  });
}
log.push("sync");
process.nextTick(() => log.push("tick0"));
Promise.resolve().then(() => log.push("micro0"));
console.log("sync-return delivered", delivered);

new Promise<void>((resolve) => {
  finish = resolve;
}).then(() => {
  const head = log.slice(0, 3).join(" ");
  const body = log.slice(3).join(" ");
  console.log("prologue", head);
  console.log("per-completion checkpoints", /^(cb tick micro )*cb tick micro$/.test(body));
  console.log("delivered", delivered, "ok", ok, "notFound", notFound, "messages", messages, "families", families);
});
