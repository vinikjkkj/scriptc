// A package whose tarball VERIFIES but whose published entry (dist/index.js)
// is not in it, so there is nothing to map.
import { D } from "distjs";

console.log(String(D));
