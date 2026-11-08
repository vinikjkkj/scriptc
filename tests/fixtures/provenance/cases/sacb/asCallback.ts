// standard-as-callback's shape: the node-style callback runs from a promise reaction; when it throws, tryCatcher answers the
// shared `errorObj` (declared `{ e: {} }`) where its declaration says `void | { e: Error }`, and asCallback compares the
// answer to `errorObj` by identity and rethrows `ret.e` later (an uncaught error: the process exits non-zero).
import { run } from "sacb/built/run.js";
run((line: string) => console.log(line));
