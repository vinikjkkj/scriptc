// replace / replaceAll with a function replacer on a dyn receiver: Node's argument list, ToString of the result, string and regex patterns.
const s: any = JSON.parse('"Hello, World 42 foo bar 7"');
console.log(s.replace(/o/g, (m: string, off: number, str: string) => "[" + m + off + str.length + "]"));
console.log(s.replace(/(\d)(\d)?/g, (m: string, a: string, b: string | undefined, off: number) => a + "," + b + "," + off + ";"));
console.log(s.replace(/(?<w>[A-Z])(?<r>\w+)/, (...args: any[]) => JSON.stringify(args[args.length - 1]) + args.length));
console.log(s.replace("World", (m: string, off: number, str: string) => m.toUpperCase() + off + str.length), s.replaceAll("o", (m: string, off: number) => String(off)));
console.log(s.replaceAll("", (m: string, off: number) => off % 5 === 0 ? "|" : ""), s.replace("zzz", () => "x"), s.replace(/zzz/, () => "x"));
console.log(s.replace(/\d+/g, (m: string) => String(Number(m) * 2)), s.replace(/o/, (m: string): any => 5));
let calls = 0;
console.log(s.replace(/[a-z]+/g, (m: string) => { calls++; return m.length + ""; }), calls);
try { s.replaceAll(/o/, () => "x"); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { s.replace(/o/g, () => { throw new RangeError("boom"); }); } catch (e) { console.log((e as Error).name, (e as Error).message); }
console.log(s.replace(/(?:)/g, (m: string, off: number) => off === 3 ? "-" : ""), s.replace(/x*/g, (m: string, off: number) => off === 0 ? ">" : ""));
