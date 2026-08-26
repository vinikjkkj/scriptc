/* The driver names TWO packages and one subpath of neither.
 *
 *   main.ts  -> hub           (root)
 *   main.ts  -> spoke         (root)
 *   spoke    -> hub/util      discovered after hub's table was built
 *   hub/util -> spoke/extra   discovered after spoke's table was built
 *   spoke/extra -> hub/deep   a second pass, not a second visit
 *
 * Nothing here imports 'hub/util' or 'hub/deep' by name, and that is the
 * whole point: which subpaths of hub resolve must not depend on which
 * file the compiler was pointed at. */
import { HUB } from "hub";
import { spin } from "spoke";

console.log(HUB);
console.log(spin("hi"));
