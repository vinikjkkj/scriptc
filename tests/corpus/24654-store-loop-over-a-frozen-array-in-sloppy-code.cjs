// The hoisted frozen-flag test in sloppy code: the stores of a frozen array are ignored, the push still throws.
/** @param {number[]} arr @param {number} k */
function fill(arr, k) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) { arr[i] = i * k; sum += arr[i]; }
  return sum;
}
/** @param {number[]} arr @param {number} n */
function pushAll(arr, n) {
  for (let i = 0; i < n; i++) arr.push(i);
  return arr.length;
}
const t = (name, f) => { try { const r = f(); console.log(name, "ok", r); } catch (e) { console.log(name, e.constructor.name + ": " + e.message); } };
const open = [0, 0, 0, 0];
const shut = [0, 0, 0, 0];
Object.freeze(shut);
t("fill open", () => fill(open, 3));
t("fill shut", () => fill(shut, 3));
t("pushAll open", () => pushAll(open, 3));
t("pushAll shut", () => pushAll(shut, 3));
console.log(open.join(), shut.join(), Object.isFrozen(open), Object.isFrozen(shut));
