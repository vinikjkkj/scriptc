/* Child stdio under REAL @types/node.
 *
 * `spawn(cmd, args, { stdio: [...] })` does not return `ChildProcess` under
 * @types/node — it returns `ChildProcessByStdio<I, O, E>`, an interface that
 * `extends ChildProcess` and only NARROWS the three slots to what the tuple
 * pinned. mapType matched the name `ChildProcess` only, so the whole async
 * child surface — the one tests/corpus/1565-spawn-pipe-streams.ts proves
 * works — was unreachable for every program that installs @types/node, which
 * is every real project. Measured before the fix, on this file's shape: 0
 * refusal sites under the shipped fallback declarations, 4 under @types/node
 * 24.13.3.
 *
 * The three READ forms are all here on purpose, because they went through
 * three different paths: the plain member read (the tuple pins the slot
 * non-null), `!` (an assertion over `Readable | null`), and `?.` (the
 * optional-chain re-dispatch). Two of the three fenced.
 *
 * Platform-neutral like tests/corpus/1657: the child is `node -e`, and the
 * observation waits for BOTH the stream's 'end' and the child's 'exit'
 * before printing, because their relative order is scheduling-dependent in
 * Node itself.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const SRC = "process.stdout.write('one\\ntwo\\n')";

/* Step 1: the tuple overload's own type, read through a plain member
 * access. `child.stdout` is `Readable` here, not `Readable | null`. */
function step1(): void {
  const child = spawn("node", ["-e", SRC], { stdio: ["ignore", "pipe", "ignore"] });
  const decoder = new StringDecoder("utf8");
  let text = "";
  const events: string[] = [];
  const finish = (): void => {
    if (events.length < 2) return;
    console.log("step1 text:", JSON.stringify(text));
    console.log("step1 events:", events.slice().sort().join(" "));
    step2();
  };
  child.stdout.on("data", (chunk: Buffer) => {
    text += decoder.write(chunk);
  });
  child.stdout.on("end", () => {
    events.push("end");
    finish();
  });
  child.on("exit", (code) => {
    events.push(`exit:${code}`);
    finish();
  });
}

/* Step 2: the same handle through a `ChildProcess`-typed binding, where the
 * slot IS `Readable | null`, read with the non-null assertion. */
function step2(): void {
  const child: ChildProcess = spawn("node", ["-e", SRC], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const decoder = new StringDecoder("utf8");
  let text = "";
  const events: string[] = [];
  const finish = (): void => {
    if (events.length < 2) return;
    console.log("step2 text:", JSON.stringify(text));
    console.log("step2 events:", events.slice().sort().join(" "));
    step3();
  };
  child.stdout!.on("data", (chunk: Buffer) => {
    text += decoder.write(chunk);
  });
  child.stdout!.on("end", () => {
    events.push("end");
    finish();
  });
  child.on("exit", (code) => {
    events.push(`exit:${code}`);
    finish();
  });
}

/* Step 3: the optional-chain form the corpus uses, on the nullable slot. */
function step3(): void {
  const child: ChildProcess = spawn("node", ["-e", SRC], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const decoder = new StringDecoder("utf8");
  let text = "";
  const events: string[] = [];
  const finish = (): void => {
    if (events.length < 2) return;
    console.log("step3 text:", JSON.stringify(text));
    console.log("step3 events:", events.slice().sort().join(" "));
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    text += decoder.write(chunk);
  });
  child.stdout?.on("end", () => {
    events.push("end");
    finish();
  });
  child.on("exit", (code) => {
    events.push(`exit:${code}`);
    finish();
  });
}

step1();
