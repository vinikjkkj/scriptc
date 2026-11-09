// process.hrtime.bigint(): a bigint of nanoseconds on a monotonic clock. Two reads never go backwards, a 10 ms busy wait advances it by at least 5 ms
// and (on a sane machine) under a second, and it is a bigint in arithmetic with other bigints, the way zapo's bench timer uses it.
const t0 = process.hrtime.bigint();
const end = Date.now() + 10;
while (Date.now() < end) {}
const t1 = process.hrtime.bigint();
const elapsedNs = t1 - t0;
console.log(typeof t0, t1 >= t0, elapsedNs >= 5_000_000n, elapsedNs < 1_000_000_000n);
const elapsedUs = Number(process.hrtime.bigint() - t0) / 1000;
console.log(elapsedUs >= 5000, elapsedUs < 1_000_000);
const recordCall = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1000;
console.log(recordCall(process.hrtime.bigint()) >= 0);
