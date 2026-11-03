const a: number[] = new Array(2).fill(1); a.length = 3;
function f(x: number[]): number { return x.length; } console.log(f(a));
