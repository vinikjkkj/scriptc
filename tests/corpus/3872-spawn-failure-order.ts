// Three spawns that all fail: the order their 'error' events arrive in.
//
// Node reports a spawn failure by queueing the event with
// process.nextTick, and that queue is FIFO — so the reports come out in
// SPAWN order. The compiled runtime keeps its unsettled children in a
// registry and settles every spawn failure on the first poll pass, so
// the registry's order IS this order; it used to push new children onto
// the HEAD and reported the three in reverse.
import { spawn } from "node:child_process";

const missing = "/definitely/not/a/binary";
const first = spawn(`${missing}-1`, [], { stdio: "ignore" });
const second = spawn(`${missing}-2`, [], { stdio: "ignore" });
const third = spawn(`${missing}-3`, [], { stdio: "ignore" });

const seen: string[] = [];
function note(tag: string, err: Error): void {
  seen.push(`${tag}=${(err as NodeJS.ErrnoException).code}`);
  if (seen.length === 3) console.log("order:", seen.join(" "));
}
first.on("error", (e) => {
  note("first", e);
});
second.on("error", (e) => {
  note("second", e);
});
third.on("error", (e) => {
  note("third", e);
});

console.log("spawned three");
