// OPEN DEFECT, pinned as the refusal it is. A function that gets properties
// added (f.tag = 1) has an own-key list that depends on the writes; only
// functions nothing ever adds to answer at compile time (corpus 8071).
function f() {}
f.tag = 1;
console.log(Reflect.ownKeys(f));
