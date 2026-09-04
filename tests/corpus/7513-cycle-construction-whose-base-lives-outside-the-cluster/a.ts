import { bName, bSees } from "./b.ts";
import { Doc } from "./doc.ts";

console.log("a: body");

export class Header extends Doc {
  // No constructor and no instance field: this class contributes nothing
  // to its own construction, so only Doc's constructor runs -- and Doc
  // lives outside the cluster.
  static readonly EMPTY = new Header(new Uint8Array([4, 7, 0, 9, 0, 2]));

  label(): string {
    return "header/" + String(this.count());
  }
}

export const aName = "A";

export function run(): void {
  console.log("EMPTY.count:", Header.EMPTY.count());
  console.log("EMPTY.label:", Header.EMPTY.label());
  console.log("EMPTY.sum:", Header.EMPTY.sum());
  console.log("bName:", bName);
  console.log(bSees());
}
