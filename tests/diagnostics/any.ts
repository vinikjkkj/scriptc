// The honest static subset of `any` compiles now — bindings, params,
// returns, assignments, reads ride the checked-dynamic tree — so what this
// fixture pins is the RESIDUE: operations only the engine's full JS
// semantics can run. Each site reports the choice: opt into the embedded
// engine, or stay static with 'unknown' + a checked cast.
const n: any = 41;
var { x } = <any>0; // destructuring a non-object 'any' — engine only
for (const v of n as any) console.log(v); // iterating an 'any' value
export const marker: number = 1;
