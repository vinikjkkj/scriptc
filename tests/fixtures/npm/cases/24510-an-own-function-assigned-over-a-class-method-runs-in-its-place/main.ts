// mysql2's execute-failure shape: after a failed prepare the command's `start` is replaced by an own function, and the runner's
// `this.start` read must find it. The sibling class and the success path keep the method.
import { run, runQuery } from "ownshadowcmd";
console.log(run(true));
console.log(run(false));
console.log(runQuery());
