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
 * each complaint below a boundary rather than a blanket refusal. */
interface Doc { [key: string]: any }
const admitted: Doc = { a: 1 };

// an `any` ARRAY: the element slot is a named slot
const arr: any[] = [1, "x"];

// an `any` MEMBER of a record: same
const rec = { item: {} as any, width: "10px" };

// arithmetic on an `any`-typed READ out of an admitted store: the store
// hands back a checked-dynamic value, and `+`/`*` on one have no static
// operand types to pick an operation from
console.log(admitted.a + 1);
console.log(admitted.a * 2);

// Object.entries over the admitted store: the checker's element type is
// the TUPLE `[string, any]`, whose second slot is named. Object.keys,
// for...in, `in`, delete, spread and JSON.stringify all compile over it.
for (const e of Object.entries(admitted)) console.log(e[0], String(e[1]));

console.log(arr.length, rec.width);
export const marker: number = 1;
