// Reads a value off a package that publishes authored JavaScript with NO
// declaration file: the published file itself is the only source there is.
import { J } from "jsonly";

console.log("J=" + String(J));
