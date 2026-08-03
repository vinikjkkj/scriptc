// A union whose every arm is a tuple over ONE element type.
//
// Each arm maps on its own -- a tuple is a record of positional fields --
// but the union of them had no representation, so a table of fixed-length
// literal rows could be built and never read back. The arms disagree on
// nothing but LENGTH, which the array representation carries at runtime,
// so the union is an array of the shared element type.
//
// `length` needs its own word: on a tuple it is the tuple's synthesized
// property, not Array.prototype's, so provenance alone refuses a read the
// representation supports. The tuple case already made an exception for
// that; a union of tuples is the same situation.

const PAIR = ["um", "dois"] as const;
const TRIPLE = ["tres", "quatro", "cinco"] as const;
const TABLES: readonly (typeof PAIR | typeof TRIPLE)[] = [PAIR, TRIPLE];

let total = 0;
for (const row of TABLES) total += row.length;
console.log(total);

// Indexing a row, and reading across the table.
console.log(TABLES[0][0], TABLES[1][2], TABLES[1].length);

// The rows flowing through a loop that reads every element.
const seen: string[] = [];
for (const row of TABLES) {
  for (let i = 0; i < row.length; i += 1) seen.push(row[i]);
}
console.log(seen.length, seen.join("|"));

// A three-armed table, and arms of equal length (nothing requires the
// lengths to differ -- the collapse is about the element type).
const A2 = ["x", "y"] as const;
const B2 = ["z", "w"] as const;
const C2 = ["p"] as const;
const MORE: readonly (typeof A2 | typeof B2 | typeof C2)[] = [A2, B2, C2];
let n = 0;
for (const row of MORE) n += row.length;
console.log(n, MORE[2][0]);

// Numeric rows: the collapse is on the shared element type, not on string.
const N1 = [1, 2, 3] as const;
const N2 = [4, 5] as const;
const NUMS: readonly (typeof N1 | typeof N2)[] = [N1, N2];
let sum = 0;
for (const row of NUMS) for (let i = 0; i < row.length; i += 1) sum += row[i];
console.log(sum);
