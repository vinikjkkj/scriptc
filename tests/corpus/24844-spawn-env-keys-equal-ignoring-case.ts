// An env REPLACEMENT holding keys that differ only in case: on Windows env keys are case-insensitive, and Node (lib/child_process.js) sorts the keys
// by code unit and keeps only the first of each case-insensitive run, so the child reads the value of "FOO" ('FOO' < 'Foo' < 'foo') through any spelling.
// POSIX keeps the three variables apart. The runtime's block sort must be a total order (mingw's qsort is not stable) and apply the same filter.
import { execFileSync } from "node:child_process";

const probe = 'console.log(process.env.Foo, process.env.FOO, process.env.foo, process.env.bar)';
const out = execFileSync("node", ["-e", probe], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, Foo: "1", bar: "0", FOO: "2", foo: "3" },
});
console.log(out.trim());
