import { bLabel, bSees } from "./b.ts";
import { attach, Cell } from "./attach.ts";

console.log("a: body");

export class Widget {
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
  describe(): string {
    return "widget " + String(this.id);
  }
}

// A construction whose own constructor body names nothing in the cluster
// (Widget, declared right here), and a construction whose constructor
// lives outside it (Cell).
export const widget = new Widget(7);
export const cell = new Cell("a");

// The call whose callee body is an Object.defineProperty with a function
// in the descriptor.
attach(cell, "extra", "a");

export const key = (): string => (process.argv.length > 99 ? "zz" : "extra");
export const aLabel = "A";

export function run(): void {
  console.log(widget.describe());
  console.log(cell.show());
  const rc = cell as unknown as Record<string, unknown>;
  console.log("extra:", String(rc[key()]));
  console.log("bLabel:", bLabel);
  console.log(bSees());
}
