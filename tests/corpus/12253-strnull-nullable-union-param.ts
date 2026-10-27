// `${v}` / "" + v / String(v) where v is a union with a unit arm, decided at run time
function show(v: string | null): string { return `<${v}>`; }
function showU(v: number | undefined): string { return `<${v}>`; }
function cat(v: string | null): string { return "x" + v; }
function str(v: boolean | undefined): string { return String(v); }
const sv: (string | null)[] = ["a", null, "b"];
for (const v of sv) console.log(show(v), cat(v), String(v));
const nv: (number | undefined)[] = [3, undefined];
for (const v of nv) console.log(showU(v));
const bv: (boolean | undefined)[] = [true, undefined];
for (const v of bv) console.log(str(v));
