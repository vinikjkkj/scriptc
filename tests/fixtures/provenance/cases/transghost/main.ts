/* The negative, reached the same transitive way. ghosty's source imports
 * both 'hub/ghost' (published, no source twin) and 'hub/util' (published,
 * has one). Neither is named here, so both are attempted in the same late
 * expansion round — one must map to its own file and the other to
 * nothing at all. */
import { HUB } from "hub";
import { MARK } from "ghosty";

console.log(HUB, MARK);
