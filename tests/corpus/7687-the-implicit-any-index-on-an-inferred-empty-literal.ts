// The boundary of the `any`-index rule, from the side that must NOT move.
//
// tsgo hands the type it infers for an EMPTY OBJECT LITERAL an implicit
// `[x: string]: any` -- the affordance that lets `{}` flow into a
// `Record<string, T>` slot. Read as a signature it would turn every
// `const o = {}` into a pure index shape, and the rest binding over one
// fences: this file compiled before `any`-valued signatures were admitted
// and has to keep compiling after. `{}` as an ANNOTATION and
// `interface Empty {}` publish no index info at all and stay the top type.
const empty = {};
const { ...rest } = empty;
console.log(JSON.stringify(empty), JSON.stringify(rest), Object.keys(rest).length);

const { ...restOfLiteral } = {};
console.log(JSON.stringify(restOfLiteral));

const grown: { a?: number } = {};
grown.a = 1;
console.log(JSON.stringify(grown));

const top: {} = 41;
console.log(String(top));

interface Empty {}
const alsoTop: Empty = "s";
console.log(String(alsoTop));

// ...while a declared signature beside them still gets the store.
interface Bag { [key: string]: any }
const bag: Bag = {};
bag.k = 1;
console.log(String(bag.k), Object.keys(bag).join(','), String(bag.missing));

// an empty literal flowing INTO the declared store keeps the store's shape
const fromEmpty: Bag = {};
console.log(Object.keys(fromEmpty).length, String(fromEmpty.nope));
