// Function replacers on a typed string that declare offset / subject / groups, or a capture that may not participate.
const s: string = "a1b22c333" + (process.argv.length > 50 ? "q" : "");
console.log(s.replace(/(\d)(\d)?/g, (m: string, d1: string, d2: string | undefined, off: number, whole: string) => `[${m}|${d1}|${d2}|${off}|${whole.length}]`));
console.log(s.replace(/\d+/g, (m: string, off: number) => `<${off}>`));
console.log(s.replace(/(?<d>\d)/, (m: string, d: string, off: number, whole: string, groups: { d: string }) => groups.d + off + whole.length));
console.log(s.replaceAll(/b|c/g, (m: string, off: number, whole: string) => m + off));
console.log("x-y".replace(/(-)|(\+)/, (m: string, a: string | undefined, b: string | undefined) => `${a}/${b}`));
console.log("x-y".replace(/(-)|(\+)/, (m: string, a: string | undefined, b: string | undefined) => `${typeof a}/${typeof b}`));
try { s.replaceAll(/\d/, (m: string, off: number) => m); } catch (e) { console.log((e as Error).name, (e as Error).message); }
const re = /(\d)(b)?/g;
console.log(s.replace(re, (m: string, a: string, b: string | undefined, off: number) => `${a}${b ?? "_"}${off}`));
