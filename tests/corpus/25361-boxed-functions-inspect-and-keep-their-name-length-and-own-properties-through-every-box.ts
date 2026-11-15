// What util.inspect / console.log print for functions that reached a dyn slot (a boxed function is the closure itself), with and without own
// properties, and that name/length/own properties are the same through every box of one closure and distinct between closures.
import { inspect } from "node:util";
const boxes: any[] = [];

function plain(a: number, b: number): number {
  return a * b;
}

function withProps(): number {
  return 7;
}

function make(label: string): () => string {
  return () => label;
}

const arrow = (x: number): number => x + 1;

boxes.push(plain);
boxes.push(withProps);
boxes.push(arrow);
boxes.push(make("one"));
boxes.push(make("two"));

console.log(inspect(boxes[0]));
console.log(inspect(boxes[2]));
const pair: any[] = [];
pair.push(boxes[0]);
pair.push(boxes[2]);
console.log(inspect(pair));

boxes[1].color = "red";
boxes[1].size = 3;
const again: any[] = [];
again.push(withProps);
console.log(inspect(boxes[1]));
console.log(again[0].color, again[0].size, boxes[1] === again[0]);

console.log(boxes[0].name, boxes[0].length, boxes[2].name, boxes[2].length);
console.log(boxes[3].name === boxes[4].name, boxes[3] === boxes[4], boxes[3]() + boxes[4]());

// property written through a second box of an arrow function
const arrowAgain: any[] = [];
arrowAgain.push(arrow);
arrowAgain[0].note = "n";
console.log(boxes[2].note, Object.keys(boxes[2]).length, Object.keys(boxes[0]).length);
console.log(inspect(boxes[2]));
