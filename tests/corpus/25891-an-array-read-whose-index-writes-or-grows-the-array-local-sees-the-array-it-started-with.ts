// arr[i] and arr.length borrow a plain local array; an index that reassigns the local, or calls a function that pushes to the same array, must still read the array that was current when the read began.
function reassignInIndex(): string {
  let a = ["a", "b", "c"];
  const x = a[(a = ["x", "y", "z"], 1)];
  return x + a[1];
}
function pushInIndex(): string {
  const a = [10, 20, 30];
  const grow = (): number => { a.push(99); return 3; };
  const v = a[grow()];
  return v + ":" + a.length + ":" + a[3];
}
function lengthAfterWrite(): number {
  let a = [1, 2, 3, 4];
  return a.length * 100 + (a = [9], a.length);
}
function strArrayLoop(): number {
  const words = ["alpha", "beta", "gamma", "delta"];
  let n = 0;
  for (let i = 0; i < 4000; i++) n += words[i % words.length]!.length + words.length;
  return n;
}
function callInIndexThrows(): string {
  const a = ["p", "q"];
  const boom = (): number => { throw new Error("idx"); };
  try { return a[boom()]!; } catch (e) { return (e as Error).message + a.length; }
}
console.log(reassignInIndex(), pushInIndex(), lengthAfterWrite(), strArrayLoop(), callInIndexThrows());
