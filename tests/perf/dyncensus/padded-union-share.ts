// Positive control for the union->dyn padding boxes (needs the census linked, see the top of scr_dyn_census.h): at the peak the NUMH row must show ~0 live nodes
// for -1 and 0 (shared immortal boxes). Before the scr_dyn_new_num_sh fix it read 74,949 and 74,951 for these 300 lists, and 246,296 -1 boxes at the mysql bench peak.
// the store's padded parameter list: one real value and padding of -1 / 0 / 1 / "" crossing into a dyn array, 300 of them held live
type P = string | number | null;
function pad(n: number, salt: number): P[] {
  const a: P[] = [];
  for (let i = 0; i < n; i++) a.push(i === 0 ? "s" + salt : i % 3 === 0 ? "" : i % 3 === 1 ? 0 : -1);
  return a;
}
const keep: unknown[] = [];
for (let i = 0; i < 300; i++) { const u: unknown = pad(751, i); keep.push(u); }
setTimeout(() => { console.log(keep.length); process.exit(0); }, 20);
