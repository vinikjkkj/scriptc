import { bTag, bEcho } from "./b.ts";
import { makeTagger } from "./tag.ts";

console.log("a: body");

// The admitted shape: a top-level call whose callee body only builds a
// closure. Without the inert-callee rule this line alone keeps SC1016 on
// the whole cluster.
export const aTag = makeTagger("a");

export function run(): void {
  console.log("a.run aTag:", aTag(1));
  console.log("a.run bTag:", bTag(2));
  console.log("a.run bEcho:", bEcho());
}
