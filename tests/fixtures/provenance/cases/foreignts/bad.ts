// The negative control for the attested-source suppression: the same
// mapped package, the same flag, but the type error is in the PROGRAM's
// own file. Its author can fix this one, so it must still gate.
import { amplify } from "foreignts";

const scaled: string = amplify(21);
console.log(scaled);
