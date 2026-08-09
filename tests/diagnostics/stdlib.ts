// tsc-clean misuses of the standard-library surface: each line below is
// valid TypeScript against the ambient declarations but outside the
// supported lowering (library, island-backed, Math, string, and number
// functions have no value form; `process` itself is not a first-class
// value).
//
// Math.floor and its fixed-arity siblings LIFT now (a memoized closure
// over the same libCall their call sites take), so the Math entry here is
// Math.max: the variadic pair is declared `(...values: number[]) => number`,
// which is not the fixed-arity shape a lift can be built for, and
// binarizing it silently would answer the wrong number.
import { readFileSync } from "node:fs";

const read = readFileSync;
const cwd = process.cwd;
const p = process;
const env = process.env;
const mx = Math.max;
const upper = "abc".toUpperCase;
const fix = (1.5).toFixed;
const pf = parseFloat;
