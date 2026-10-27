// .constructor on a union that holds an instance and a string, with a
// null-guarded read; the class value is compared by identity.
class Node1 { tag = 'n'; }
class Leaf extends Node1 { size = 2; }
function classify(v: string | Leaf | Node1): string {
  if (v.constructor === Leaf) return 'leaf';
  if (v.constructor === Node1) return 'node';
  if (v.constructor === String) return 'text';
  return 'unknown';
}
console.log(classify(new Leaf()), classify(new Node1()), classify('abc'));
const k = classify;
console.log(k(new Leaf()) === 'leaf', Leaf === Node1, Node1 === Node1);
