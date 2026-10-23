// A package whose declaration files (a.d.ts <-> b.d.ts) form an import cycle; the
// implementations (a.js, b.js) read each other only inside functions.
import { fa, fb } from "declcycle";

console.log(typeof fa, typeof fb);
