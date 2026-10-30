// `||=`, `&&=` and `??=` name an anonymous function on the right when the
// left is a plain identifier (NamedEvaluation); `=` already did.
let lo: any = null;
lo ||= (): number => 8;
console.log(lo.name, lo);
let la: any = (): number => 9;
la &&= (): number => 10;
console.log(la.name, la);
let mut: any = (): number => 12;
mut = function named(): number { return 13; };
console.log(mut.name);
