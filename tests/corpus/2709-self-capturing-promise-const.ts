// A const whose own initializer captures it: the self-deregistering
// promise, which is how an in-flight operation clears its own slot.
//
//   const promise = work().finally(() => { if (cur === promise) cur = null })
//
// Legal in JS because the reaction runs after the binding is initialized;
// reading it earlier is a TDZ ReferenceError.
//
// The machinery for this already existed and even named this shape --
// forward-captured consts pre-declare as TDZ boxes, reads test the box and
// throw Node's exact error while it is empty. `promise` simply was not
// among the eligible kinds, though it is heap, refcounted and
// pointer-backed exactly like the runtime handles listed beside it, so the
// box's NULL sentinel works unchanged.

let current: Promise<void> | null = null;
async function work(): Promise<void> { await new Promise((r) => setTimeout(r, 1)); }
function start(): Promise<void> {
  // o closure referencia o proprio binding sendo inicializado
  const promise = work().finally(() => {
    if (current === promise) current = null;
  });
  current = promise;
  return promise;
}
async function main(): Promise<void> {
  await start();
  console.log("current apos:", current === null ? "null" : "ainda setado");
}
void main();
