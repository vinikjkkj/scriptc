// An env REPLACEMENT holding keys that differ only in case: on Windows env keys are case-insensitive, and Node (lib/child_process.js) sorts the keys
// by code unit and keeps only the first of each case-insensitive run, so the child reads the value of "FOO" ('FOO' < 'Foo' < 'foo') through any spelling.
// The fold is JS's full toUpperCase, so "straße" and "STRASSE" are one key on Windows ('ß' upper-cases to "SS") and 'STRASSE' wins by code unit order, while the
// OS's own ordinal case-insensitive compare would keep both. POSIX keeps every variable apart. The runtime's block sort must be a total order (mingw's qsort is not
// stable) and apply the same filter.
import { execFileSync } from "node:child_process";

const probe = 'console.log(process.env.Foo, process.env.FOO, process.env.foo, process.env.bar, process.env["straße"], process.env.STRASSE)';
const out = execFileSync("node", ["-e", probe], {
  encoding: "utf8",
  env: { PATH: process.env.PATH, Foo: "1", bar: "0", FOO: "2", foo: "3", "straße": "4", STRASSE: "5" },
});
console.log(out.trim());

// The filter runs BEFORE undefined values are dropped: on Windows the first key of the "FOO" class ('FOO') survives even though its value is undefined,
// the later undefined-skipping pass then drops it, and the variable vanishes although 'Foo' held a value. POSIX keeps Foo.
const withUndefined: { [k: string]: string | undefined } = { PATH: process.env.PATH, Foo: "7", FOO: undefined, other: "x" };
const out2 = execFileSync("node", ["-e", 'console.log(process.env.Foo, process.env.FOO, process.env.other)'], { encoding: "utf8", env: withUndefined });
console.log(out2.trim());
