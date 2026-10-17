// Drives both argument-taking exports of an authored-JavaScript package. Every
// call passes a LITERAL, so implicit-any monomorphization has a concrete type
// to specialize the body on -- the question this program asks is only whether
// the gate that does so is switched on for a file reached through provenance.
import { bucketOf, wireCodeOf } from "monoarg";

console.log("wire.private=" + String(wireCodeOf("private")));
console.log("wire.regular=" + String(wireCodeOf("regular")));
console.log("bucket.realtime=" + String(bucketOf("realtime")));
console.log("bucket.default=" + String(bucketOf("regular")));
