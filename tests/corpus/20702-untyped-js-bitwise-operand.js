// whatwg utils.js shape: an untyped JS parameter ToNumber'd by `>>> 0`
// and then compared, after a typeof guard.
function uint32Index(P) {
  if (typeof P !== "string") {
    return false;
  }
  const i = P >>> 0;
  if (i === 2 ** 32 - 1) {
    return false;
  }
  return `${i}` === P;
}
function mixed(v, w) {
  return (v | 0) + (v & w) + (v ^ 1) + (w << 2);
}
console.log(uint32Index("4294967294"), uint32Index("4294967295"), uint32Index(12), uint32Index("012"));
console.log(mixed(5, 3), mixed("6", 2), mixed(true, 7), mixed(undefined, null));
