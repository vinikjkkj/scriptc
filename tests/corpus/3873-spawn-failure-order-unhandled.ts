// @exit: 1
// What the spawn-failure ORDER costs when the second failure has no
// listener: an unhandled 'error' event ends the program, so whether the
// FIRST child's handler ever runs is decided by which report goes out
// first. Node's nextTick queue is FIFO and the handled one is first, so
// its line prints and only then does the program die. Reversing that
// order — which the compiled runtime used to do, by pushing new children
// onto the head of its registry — swallowed the line entirely, with no
// stdout of its own to show for it. 1466 hit exactly this.
import { spawn } from "node:child_process";

const missing = "/definitely/not/a/binary";
const handled = spawn(`${missing}-handled`, [], { stdio: "ignore" });
spawn(`${missing}-bare`, [], { stdio: "ignore" });

handled.on("error", (e) => {
  console.log("handled first:", (e as NodeJS.ErrnoException).code);
});

console.log("spawned two");
