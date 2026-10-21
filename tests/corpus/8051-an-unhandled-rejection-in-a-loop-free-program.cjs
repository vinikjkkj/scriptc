// @exit: 1
// A program with no async function, timer or generator still gets Node's
// event loop: a rejection nobody handled by the end of the first checkpoint
// is fatal (status 1) AFTER the synchronous body printed everything.
const ok = Promise.resolve(1);
const handled = Promise.reject(new Error("handled")).catch(() => console.log("handled ran"));
Promise.reject(new Error("nobody handles this"));
console.log("body done", typeof ok, typeof handled);
