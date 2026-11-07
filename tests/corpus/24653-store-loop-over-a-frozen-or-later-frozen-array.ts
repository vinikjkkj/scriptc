// A loop whose body cannot freeze anything tests the frozen flag once before it (the hoist); a loop that can freeze mid-way keeps the per-store test.
// Both must behave exactly like Node (ES module = strict): the frozen array refuses its stores, the later-frozen one stores until the freeze.
function fill(arr: number[], k: number): number {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) { arr[i] = i * k; sum += arr[i]!; }
  return sum;
}
function pushAll(arr: number[], n: number): number {
  for (let i = 0; i < n; i++) arr.push(i);
  return arr.length;
}
const t = (name: string, f: () => unknown): void => {
  try { const r = f(); console.log(name, "ok", r); } catch (e) { console.log(name, (e as Error).constructor.name + ": " + (e as Error).message); }
};
const open: number[] = [0, 0, 0, 0];
const shut: number[] = [0, 0, 0, 0];
Object.freeze(shut);
t("fill open", () => fill(open, 3));
t("fill shut", () => fill(shut, 3));
t("pushAll open", () => pushAll(open, 3));
t("pushAll shut", () => pushAll(shut, 3));
const mid: number[] = [0, 0, 0, 0, 0, 0];
t("freeze mid-loop", () => {
  for (let i = 0; i < mid.length; i++) { mid[i] = i + 1; if (i === 2) Object.freeze(mid); }
  return mid.join();
});
console.log(open.join(), shut.join(), mid.join(), Object.isFrozen(open), Object.isFrozen(shut), Object.isFrozen(mid));
