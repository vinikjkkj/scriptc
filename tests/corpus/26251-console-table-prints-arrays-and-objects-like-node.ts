// console.table in static code: arrays and objects of rows (objects, arrays, primitives, mixed), the column filter, cells inspected at depth 0 (-1 for objects of more than two keys) with at most three array items, and Node width for wide characters.
interface Row { a: number; b: string }
const rows: Row[] = [{ a: 1, b: "x" }, { a: 22, b: "yy" }];
console.table(rows);
console.table(rows, ["b"]);
console.table([1, "two", true, null]);
console.table([[1, 2], [3, 4]]);
console.table({ r1: { x: 1 }, r2: { y: 2 } });
console.table([{ a: 1 }, 5, { b: "日本語" }]);
console.table([{ n: { deep: { d: 1 } }, l: [1, 2, 3, 4, 5], o: { p: 1, q: 2, r: 3 } }]);
const dyn: any = JSON.parse('[{"k":"v","n":null},{"k":"w","z":[1,2]}]');
console.table(dyn);
console.table({ one: [1, 2], two: [3] });
console.table([{ w: "é中Ａ", e: "" }]);
console.table("scalar"); console.table(7); console.table(false);
