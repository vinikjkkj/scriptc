/* A package whose own repo's tsconfig claims a SUBPATH of one of its
 * installed dependencies. Node resolves `aliaspkg2/extra` to the installed
 * aliaspkg2; the tsconfig claims it for an in-repo copy at a different
 * commit. Only one of those is what the program does at run time. */
import { host } from "shadowpkg";

console.log(host("zz"));
