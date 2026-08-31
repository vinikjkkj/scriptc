/* The REFUSED half of stdlib-surfaces.ts, and the negative controls that
 * keep the globalThis fold from claiming more than it proved.
 *
 * Every line here typechecks under @types/node — that is @types/node's job
 * — and must fail COMPILATION with a fence that names what is missing, not
 * compile into a binary that answers something plausible. */

/* The memoryUsage() RECORD: four of its five fields are V8 heap statistics
 * and there is no V8 heap here. 0 would read as a measurement. */
console.log(process.memoryUsage());

/* uncaughtException is a BEHAVIOUR this runtime cannot honour: an escaped
 * throw prints "Uncaught <error>" and exits 1 AT THE THROW, so a listener
 * could never fire and the loop never resumes. A handler registered and
 * never called is worse than the refusal. */
process.on("uncaughtException", (err) => {
  console.error(err);
});
process.once("uncaughtExceptionMonitor", (err) => {
  console.error(err);
});

/* NEGATIVE CONTROL — a global this compiler DOES provide. A cast that
 * makes `crypto` optional must not buy an `undefined` answer: the receiver
 * still sees @types/node's non-optional `var crypto`. */
const c = (globalThis as { crypto?: { randomUUID(): string } }).crypto;
console.log(c === undefined);

/* NEGATIVE CONTROL — the member declared NON-optional. The site cannot
 * represent `undefined`, so the program asked for a value and gets a fence
 * rather than a lie. */
const hard = (globalThis as { gc: () => void }).gc;
console.log(typeof hard);

/* NEGATIVE CONTROL — WebSocket is excluded by name. It is the one global
 * with a STRUCTURAL lowering above the fold that can decline (on a
 * construct signature it cannot build), and that decline means "fence". */
interface Weird {
  new (u: string, extra: { q: RegExp }): { z: number };
}
const w = (globalThis as unknown as { WebSocket?: Weird }).WebSocket;
console.log(w === undefined);

/* NEGATIVE CONTROL — a name NOTHING declares. Absence of a declaration is
 * not evidence of absence: the shipped fallback declares what scriptc
 * SUPPORTS, so folding on silence answered `undefined` for two dozen
 * globals Node really has (navigator, Blob, Request, Response, ...). The
 * evidence has to be a declaration that says so, and there is none here. */
const sniff = (globalThis as { window?: { name: string } }).window;
console.log(sniff === undefined);
