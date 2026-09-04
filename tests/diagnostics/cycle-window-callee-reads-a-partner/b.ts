// The cycle-closing edge. `aSeed` is READ inside makeTagger's body --
// a deferred position, so rule 2 is satisfied -- but makeTagger is
// called right here, at b's top level, while a is still uninitialized.
import { aSeed } from "./a.ts";

console.log("b: body");

function makeTagger(name: string): (n: number) => string {
  const seed = aSeed;
  return function tagger(n: number): string {
    return name + "#" + String(n + seed);
  };
}

export const bTag = makeTagger("b");
