// Reads two consts off a package that publishes NO provenance attestation.
// The values travel from the installed tarball's own index.js to here, so a
// body that never joined the program is a wrong number here, not a refusal.
import { WIRE_LIMIT, TAG } from "unattlocal";

console.log("limit=" + String(WIRE_LIMIT));
console.log("tag=" + TAG);
