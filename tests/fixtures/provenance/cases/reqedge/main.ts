// A CommonJS package (reqcons) requires a second package (reqarr) that publishes
// a hand-written .d.ts with generic overloads beside its implementation. The
// require binding's member calls must reach the twin's body, and the twin's module
// init must have run before the first call (a null global otherwise).
import { flags, plain } from "reqcons";

console.log(JSON.stringify(flags("{t,f,t}")));
console.log(JSON.stringify(plain("{x,y,z}")));
