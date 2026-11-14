interface Node { name: string; peer: Node | null; pad: number[]; }
const N = 3000, M = 1000;
const live: Node[] = [];
function mk(i: number): Node { return { name: "n" + i, peer: null, pad: [i, i + 1, i + 2] }; }
function garbageCycles(n: number) { for (let i = 0; i < n; i++) { const a = mk(i), b = mk(i + 1); a.peer = b; b.peer = a; } }
for (let i = 0; i < M; i++) live.push(mk(i));
garbageCycles(N);
setTimeout(() => { console.log("turn", live.length); }, 5);
