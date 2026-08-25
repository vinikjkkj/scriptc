/* The NEGATIVE: 'dualdist/ghost' is exported by the published package and
 * has NO twin in the attested source tree. It must not map to anything —
 * least of all to a sibling subpath's source — and the miss must be named
 * out loud in the notes. */
import { VERSION } from "dualdist";
import { GHOST } from "dualdist/ghost";

console.log(VERSION, GHOST);
