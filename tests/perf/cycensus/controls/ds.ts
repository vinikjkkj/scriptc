const held: any[] = [];
function siteA(n: number) { for (let i = 0; i < n; i++) { const o: any = JSON.parse('{"a":1,"b":2,"c":3}'); held.push(o); } }
function siteB(n: number) { for (let i = 0; i < n; i++) { const o: any = JSON.parse('{"x":1,"y":"s"}'); held.push(o); } }
function siteC(n: number) { for (let i = 0; i < n; i++) { const o: any = JSON.parse('[1,2,3,4,5,6,7,8,9,10]'); held.push(o); } }
const fs: ((n: number) => void)[] = [siteA, siteB, siteC];
const ns = [1000, 500, 200];
for (let i = 0; i < 3; i++) fs[i](ns[i]);
setTimeout(() => { console.log(held.length); }, 5);
