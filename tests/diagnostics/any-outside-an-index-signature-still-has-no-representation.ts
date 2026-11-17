/* The line the `any`-valued INDEX SIGNATURE draws, from the refused side.
 *
 * A signature's value is the overflow store's value, and the store has one
 * representation for a value whose type is not known statically -- so
 * `[k: string]: any` compiles, on the same store `[k: string]: unknown`
 * already used. `any` in a NAMED slot is a different question: nothing
 * tells the compiler what representation to build there, and every
 * spelling below keeps its SC2011 arm and its --dynamic hint.
 *
 * The two halves are shown side by side deliberately: `admitted` is the
 * shape this file does NOT complain about, and its presence is what makes
 * each complaint below a boundary rather than a blanket refusal. (An `any` member of a record LITERAL held in an unannotated variable is no longer one of
 * them: it is the checked-dynamic slot, rows 25500-25509.) */
interface Doc { [key: string]: any }
const admitted: Doc = { a: 1 };

// an `any` ARRAY: the element slot is a named slot
const arr: any[] = [1, "x"];

// An `any[]` returned by a CALL (arr.concat): the result slot is named, so it keeps its SC2011. (Object.values / Object.entries over an `any`-valued signature and
// the for...in / spread / JSON.stringify surfaces compile over the admitted store.)
const joined = arr.concat([2]);

console.log(arr.length, joined.length, Object.keys(admitted).length);
export const marker: number = 1;
