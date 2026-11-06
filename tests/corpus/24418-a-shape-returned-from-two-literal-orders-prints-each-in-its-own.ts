type R = { done: boolean; value: number | undefined };
function viaTernary(n: number): R { return n < 2 ? { value: n, done: false } : { done: true, value: undefined }; }
function viaReturns(n: number): R { if (n < 2) return { value: n, done: false }; return { done: true, value: undefined }; }
console.log(viaTernary(1), viaTernary(2));
console.log(viaReturns(1), viaReturns(2));
console.log(JSON.stringify(viaReturns(1)), JSON.stringify(viaReturns(2)));
