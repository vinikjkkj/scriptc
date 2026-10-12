// Reads one const off an authored-JavaScript package whose own implementation
// requires a SECOND package. The value travels the whole chain —
// depts/src/index.ts -> authoreddep/index.js -> here — so a missing edge
// anywhere in it is a refusal here, not a quiet zero.
import { WIRE_LIMIT } from "authoreddep";

console.log("limit=" + String(WIRE_LIMIT));
