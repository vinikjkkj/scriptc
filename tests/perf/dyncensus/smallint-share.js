// Does a dyn number that is a small integer allocate? 25,000 separately computed values of each kind are held live at exit:
//   shared (must add NOTHING to the census, the box is one immortal node):  7, 1023 and -128 (the two edges of the shared range), 0
//   distinct (must add 25,000 live nodes each):  -0 (equal to 0, a different value), 0.5 (a fraction), 1024 and -129 (one past each edge), 5000
// With the sharing the NUM row at exit is 125,000 live nodes; without it 225,000. The -0 arm is the positive control that sharing did not
// swallow the sign of zero, and 1024 / -129 that it did not stretch past the table. (25,000 of each rather than more: the census pointer
// table holds 262,144 live nodes and refuses to count past it.) Run it with the census linked (see the top of scr_dyn_census.h) and read
// the NUM row at exit; the same program built without the sharing is the positive control for the census itself.
function add(a, b) { return a + b; }
const N = 25000;
const held = [[], [], [], [], [], [], [], [], []];
for (let i = 0; i < N; i++) {
  held[0].push(add(3, 4));
  held[1].push(add(1000, 23));
  held[2].push(add(-100, -28));
  held[3].push(add(0, 0));
  held[4].push(add(-0, -0));
  held[5].push(add(0.25, 0.25));
  held[6].push(add(1000, 24));
  held[7].push(add(-100, -29));
  held[8].push(add(2500, 2500));
}
setTimeout(() => {
  console.log(held.map((a) => a.length).join(), Object.is(held[4][5], -0), Object.is(held[3][5], 0), Object.is(held[0][5], held[0][6]), held[1][3], held[2][3], held[6][3], held[7][3], held[8][3]);
  process.exit(0);
}, 50);
