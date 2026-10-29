// A class instance (no own toString) inspects at the options depth.
import { formatWithOptions } from "node:util";

class Node2 {
  name: string;
  child: { value: { deep: number } };
  constructor(name: string) {
    this.name = name;
    this.child = { value: { deep: 9 } };
  }
}
const n = new Node2("root");
console.log(formatWithOptions({ depth: 0 }, "%O", n));
console.log(formatWithOptions({ depth: 1 }, "rest", n));
console.log(formatWithOptions({ depth: 3 }, "%O", n));
