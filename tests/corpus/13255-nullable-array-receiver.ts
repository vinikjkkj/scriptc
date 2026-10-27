// A nullable array receiver: the method runs on the array while the value is one,
// and throws Node's TypeError exactly when the value IS null at run time.
const holder: { rows: number[] | null } = { rows: [] };
// @ts-ignore
holder.rows.push(2);
console.log(holder.rows?.length);
function clear(h: { rows: number[] | null }): void {
  h.rows = null;
}
clear(holder);
try {
  // @ts-ignore
  holder.rows.push(3);
  console.log("unreachable");
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
