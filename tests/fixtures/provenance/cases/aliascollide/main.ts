/* TWO attested repos, both spelling `@core`, both mapped into ONE program.
 * The merged tsconfig "paths" table has one entry per key, so whichever
 * package writes it last used to decide what BOTH of them mean — and
 * because the two `shoutCore`s have identical signatures, the program
 * still compiled and still ran. It just printed the other repo's answer. */
import { spin } from "aliaspkg";
import { twirl } from "aliaspkg2";

console.log(spin("hi"));
console.log(twirl("Yo"));
