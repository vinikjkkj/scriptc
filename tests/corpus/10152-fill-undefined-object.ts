// Object elements: (Rec | undefined)[] from a fill, truncated and regrown.
interface Rec { id: number; tag: string }

function table(max: number): (Rec | undefined)[] {
  const rows: (Rec | undefined)[] = new Array(max).fill(undefined);
  rows[0] = { id: 1, tag: "one" };
  rows[2] = { id: 3, tag: "three" };
  return rows;
}

const rows = table(3);
console.log(rows.length, rows[0]?.tag, rows[1] === undefined, rows[2]?.id);
rows.length = 1;
console.log(rows.length, rows[0]?.id, rows[2] === undefined);
rows.length = 2;
rows[1] = { id: 2, tag: "two" };
console.log(rows.length, rows[1]?.tag);
