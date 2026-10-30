// createServer({ keepAliveTimeout }) validates at construction (Node's validateInteger
// with min 0 and max 2^53-1): fractions, NaN, Infinity, negatives and too-large values
// throw ERR_OUT_OF_RANGE; 0 and 5000 are accepted and read back.
import * as http from "http";
const values: number[] = [-1, 1.5, NaN, Infinity, 9007199254740992, 0, 5000];
for (const v of values) {
  try {
    const s = http.createServer({ keepAliveTimeout: v }, () => {});
    console.log(v, "ok", s.keepAliveTimeout);
  } catch (e: any) {
    console.log(v, "THROW", e.name, e.code, JSON.stringify(e.message));
  }
}
