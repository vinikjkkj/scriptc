// An unreached JS body whose statements carry compile fences that DEFER to
// runtime (JS sources always defer -- deferFences). The REMAINDER lowerer
// (coverage's unreached pass) lowers this body to compute stats, and its
// statements still carry fences exactly like a reached JS statement would
// (error-code-slot-write.js proves both lines below fence when reached).
// Nothing calls unusedJsCorner, so its fences only ever exist in
// `rem.runtimeFences` -- this fixture demonstrates lowerer.ts:731 discarding
// them.
function used(n) {
  return n + 1;
}

function unusedJsCorner() {
  const e = new Error("z");
  e.code = 42; //    FENCES: Node stores a number; the slot is a ScrStr*
  e.fatal = true; // FENCES: no slot of any kind
  return e;
}

console.log(used(41));
