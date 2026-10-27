// A void call and a number call compared with undefined, in both orders.
let n = 0;
function v(): void { n++; console.log("v " + n); }
function h(): number { n++; console.log("h " + n); return 2; }
console.log(v() === undefined);
console.log(v() !== undefined);
console.log(h() !== undefined);
console.log(undefined !== h());
console.log("n=" + n);
