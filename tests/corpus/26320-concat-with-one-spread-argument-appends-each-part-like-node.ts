const ps: number[][] = [[5], [6, 7], []];
console.log([1, 2].concat(...ps));
console.log(([] as number[]).concat(...ps), [9].concat(...ps).length);
const ws = ["x", "y"]; console.log(["a"].concat(...ws));
const ss: string[][] = [["p", "q"], ["r"]]; console.log(["a"].concat(...ss));
function parts() { console.log("parts"); return ps; }
console.log([0].concat(...parts()));
const bools: boolean[] = [true]; console.log([false].concat(...bools));
class P { n: number; constructor(n: number) { this.n = n; } } const objs = [[new P(1)], [new P(2), new P(3)]];
console.log([new P(0)].concat(...objs).map((p) => p.n));
