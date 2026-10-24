// A JS value typed Function (JSDoc) takes a rest signature, and a call with
// ONE argument must deliver that argument: the callee has no checker
// signature to pack against, so the call rides the checked-dynamic boundary
// (as the two-argument form does).
/** @type {Function} */
const g = (...a) => 'n' + a.length + ':' + a[0];
console.log(g(2), g(2, 3), g('x'));
