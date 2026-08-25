/* Subpath VALUE imports of a package whose published "import" targets sit
 * two segments deep (dist/esm/…). The root subpath maps today by the
 * src/index.ts fallback; './util' is the one that needs the mapping. */
import { VERSION } from "dualdist";
import { shout, TAG } from "dualdist/util";

console.log(VERSION);
console.log(TAG, shout("hi"));
