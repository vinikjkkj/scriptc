// A fractional count is an invalid array length in the constructor as well.
class Grid {
  public readonly rows: number
  public readonly cells: number[]
  constructor(rows: number) {
    this.rows = rows
    this.cells = new Array(rows)
  }
}
function fill(r: number): Grid {
  const g = new Grid(r)
  for (let i = 0; i < r; i++) g.cells[i] = i
  return g
}
for (const r of [1.5, 2]) {
  try {
    console.log("rows", fill(r).cells.join(","))
  } catch (e) {
    console.log("threw", (e as Error).name, (e as Error).message)
  }
}
