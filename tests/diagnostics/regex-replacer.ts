// The fences a function replacement value keeps, each naming its reason.
//
// The decision behind the first group: Node hands a capture group that
// did not participate `undefined`, distinct from a participating-empty
// `""`. A replacer's parameter type is the author's, so an unprovable
// group is refused at compile time rather than quietly answered "" the
// way divergence 51 answers match/matchAll/exec and `$1`.
//
// (This file replaces regex-checker.ts, whose only remaining entry was
// the blanket "function replacement values" fence — that spelling
// compiles now, exactly as exec and `new RegExp` did before it.)

// A group under a zero-minimum quantifier never gets proved.
console.log("a".replace(/(a)(z)?/g, (m: string, g1: string, g2: string) => g1 + g2));
console.log("a".replace(/x(a)*/g, (m: string, g1: string) => g1));

// An ENCLOSING alternation can route around the group.
console.log("a".replace(/(a)|(b)/g, (m: string, g1: string) => g1));
console.log("a".replace(/((a)|b)c/g, (m: string, g1: string, g2: string) => g2));

// A group inside a lookaround: never participates when the assertion is
// negative, and refused conservatively when it is positive.
console.log("ab".replace(/a(?!(c))/g, (m: string, g1: string) => g1));
console.log("a".replace(/(?=(a))a/g, (m: string, g1: string) => g1));

// A `{n,m}` quantifier on a group is a form this scan declines to parse.
console.log("aa".replace(/(a){2}/g, (m: string, g1: string) => g1));

// The trailing offset/subject/groups parameters have no lowering.
console.log("ab".replace(/(a)/g, (m: string, g1: string, off: number) => g1 + off));
console.log("ab".replace(/a/g, (m: string, x: string) => m + x));

// The pattern has to be readable at the call for the proof to run.
let re = /(a)/g;
console.log("a".replace(re, (m: string, g: string) => g));
const flags = "g";
console.log("a".replace(new RegExp("(a)", flags), (m: string, g: string) => g));

// A flag outside the lowered alphabet. A regex LITERAL is fenced when it
// lowers, but `new RegExp(p, "d")` arrives here with flags the backends
// cannot represent — and the desugar completes them with 'g', which used
// to hand the emitter an unrepresentable regexLit (an SC9001 ICE).
console.log("a".replace(new RegExp("(a)", "d"), (m: string, g: string) => g));
console.log("a".replace(new RegExp("(a)", "v"), (m: string, g: string) => g));

// replaceAll over a non-global regex throws Node's TypeError; the
// desugar would swallow it, so the fence stays.
console.log("a".replaceAll(/(a)/, (m: string, g: string) => g));
