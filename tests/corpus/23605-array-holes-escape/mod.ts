export const table: string[] = ["a", "b"];
table[4] = "e";

export function make(n: number): number[] {
  const out: number[] = new Array(n);
  out[1] = 1;
  out[3] = 3;
  return out;
}

export class Holder {
  cells: string[];
  nums: number[];
  constructor(n: number) {
    this.cells = new Array(n);
    this.nums = new Array(n);
  }
  size(): number {
    let k = 0;
    this.cells.forEach(() => { k++; });
    return k;
  }
}

export function describe(xs: (string | number | undefined)[]): string {
  const present: string[] = [];
  xs.forEach((v, i) => present.push(`${i}=${v}`));
  return `${xs.length}:${present.join(",")}`;
}
