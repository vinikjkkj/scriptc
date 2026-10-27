// Surplus arguments with side effects to a function and to a constructor (JS
// npm package), with order checks, plus an absent property read on an
// object-literal argument used in || chains (mysql_clear_password shape).
import { zeroArity, fnSurplus, ctorSurplus, keptBeforeSurplus, ctorKeptBeforeSurplus, argumentsReader, clearPlain, clearOpt, absentChain } from "surplus13800";

console.log(zeroArity());
console.log(fnSurplus());
console.log(ctorSurplus());
console.log(keptBeforeSurplus());
console.log(ctorKeptBeforeSurplus());
console.log(argumentsReader());
console.log(clearPlain({}));
console.log(clearPlain({ password: "cmd" }));
console.log(clearOpt({}));
console.log(absentChain({}));
console.log(absentChain({ alt: "A" }));
