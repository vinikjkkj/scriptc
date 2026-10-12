// Reads two consts off a MAPPED package whose own implementation requires
// a package that publishes no attestation. Nothing here names that second
// package: the only path to it is the mapped package's dependency edge,
// which is the shape mysql2's iconv-lite and long actually arrive by.
import { WIRE_LIMIT, TAG } from "unattmid";

console.log("limit=" + String(WIRE_LIMIT));
console.log("tag=" + TAG);
