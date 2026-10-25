// Negative control shape for the reader: the fill value is a computed
// undefined from a function, not the literal, and the array is only read.
function nothing(): undefined {
  return undefined;
}

const cells: (number | undefined)[] = new Array(2).fill(nothing());
console.log(cells.length, cells[0], cells[1]);
cells[1] = 9;
console.log(cells[1], cells.length);
