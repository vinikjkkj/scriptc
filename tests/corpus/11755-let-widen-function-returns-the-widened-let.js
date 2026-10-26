// A function that returns a let reassigned another primitive: the return
// carries the value Node returns (the string), not a number coerced from it.
function pad(num, value) {
  const s = value.toString();
  if (s.length >= num) return s;
  return ('000000' + s).slice(-num);
}
function widened(decimals, raw) {
  let ms = 0;
  ms = raw;
  if (decimals) {
    ms = pad(6, ms);
  }
  return ms;
}
console.log(widened(3, 1234567), widened(0, 9));
const plain = (n) => {
  let out = 0;
  out = n;
  return out;
};
console.log(plain(4), typeof plain(4));
