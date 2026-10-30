// Pushed nested arrays: the element type is number[].
const rows = [];
rows.push([1, 2]);
rows.push([3]);
console.log(rows[0][1], rows[1][0], rows.length, rows);
