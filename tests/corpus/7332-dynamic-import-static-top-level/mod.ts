export const VAL = 42;
export let counter = 0;
export function bump(): number { counter += 1; return counter; }
export function greet(n: string): string { return "hi " + n; }
export class Thing {
  readonly n: number;
  constructor(n: number) { this.n = n; }
  double(): number { return this.n * 2; }
}
export class Sub extends Thing {
  override double(): number { return this.n * 3; }
}
export const REC = { tool: "scriptc", version: 1 };
export const LIST = [1, 2, 3];
export default "the-default";
console.log("mod evaluated");
