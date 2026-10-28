const a: number[] = new Array(2).fill(1); a.length = 3;
function g(): number[] { return a; } console.log(g().length);
