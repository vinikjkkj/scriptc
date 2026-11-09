// Array.prototype.flat over typed nested arrays: the default depth, 0, 1, 2 and Infinity, string and number elements, an empty inner array, an empty outer array, a
// three-level nesting flattened one level at a time, and the result being a fresh array whose elements are the inner values.
const words: string[][] = [["a", "b"], [], ["c"], ["d", "e", "f"]];
console.log(words.flat().join(","), words.flat(1).length, words.flat(0).length, words.flat(0)[0]!.join("+"));
const deep: number[][][] = [[[1, 2], [3]], [[4]], [], [[5, 6, 7], []]];
console.log(deep.flat().length, JSON.stringify(deep.flat()));
console.log(deep.flat(1).length, deep.flat(2).join(","), deep.flat(Infinity).join(","), JSON.stringify(deep.flat(0)));
const none: string[][] = [];
console.log(none.flat().length, [[], []].flat().length);
const fresh = words.flat();
fresh.push("z");
console.log(fresh.length, words.flat().length);
const nested: string[][][][] = [[[["x"], ["y", "z"]]], [[["w"]]]];
console.log(nested.flat(3).join(""), nested.flat(Infinity).join(""), nested.flat(2).length, nested.flat(5).join(""));
const rows: { n: number }[][] = [[{ n: 1 }], [{ n: 2 }, { n: 3 }]];
console.log(rows.flat().map((r) => r.n).join(","));
// Sparse arrays: a hole is skipped at the outer and at the inner level, and the receiver's own holes stay out of flat(0)'s copy.
const sparse: (number | undefined)[][] = [[1, , 3], [, 5], [,]];
console.log(sparse.flat().length, sparse.flat(0).length, sparse.flat(Infinity).length);
const gappy = new Array<number[]>(3);
gappy[1] = [7, 8];
console.log(gappy.flat().length, gappy.flat(0).length, gappy.length, 0 in gappy);
