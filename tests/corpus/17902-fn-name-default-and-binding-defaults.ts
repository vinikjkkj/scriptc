// The default of a parameter and the default of a destructuring binding are
// NamedEvaluation positions: the function takes the binding's name.
import * as util from "node:util";
function dp(cb: any = (): number => 3): any { return cb; }
const { dd = (): number => 4 }: { dd?: () => number } = {};
const [ad = (): number => 5]: (() => number)[] = [];
const named = dp();
console.log(named.name, util.inspect(named));
console.log(dd);
console.log(ad);
