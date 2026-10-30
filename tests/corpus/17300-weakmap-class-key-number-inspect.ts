class Node1 {
  label = "n";
}

const first = new Node1();
const second = new Node1();
const weights = new WeakMap<Node1, number>();
weights.set(first, 1);
weights.set(second, 2);
console.log(weights);
console.log(weights.get(first), weights.has(second), weights.delete(second), weights.has(second));
console.log(weights);
