// The base runner's `this.start` read spans subclasses that declare `start` with different signatures; an own `start` written over
// one command's method must still win for that command, and every other command keeps its own method.
import { run } from "ownshadowhet";
for (let k = 0; k < 4; k++) {
  console.log(run(k, true));
  console.log(run(k, false));
}
