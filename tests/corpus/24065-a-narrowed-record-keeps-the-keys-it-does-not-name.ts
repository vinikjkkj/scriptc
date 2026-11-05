// A width conversion used to end the members the narrower shape does not name; the converted record is the same object, so JSON, key listing and writes see all of them.
interface Row { inner: number; middle: string; tag: boolean }
interface Wide { inner: number; middle: string; tag: boolean; extra: string }
const wide: Wide = { inner: 1, middle: "m", tag: true, extra: "x" };
const narrow: Row = wide;
const narrowWidened: object = narrow;
console.log(JSON.stringify(narrowWidened));
console.log(JSON.stringify(narrow), Object.keys(narrow).join(","));
narrow.inner = 5;
console.log(wide.inner, JSON.stringify(wide));
