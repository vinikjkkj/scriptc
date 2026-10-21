// Identifiers spelled like Object.prototype members are ordinary bindings.
const valueOf = (n: number): number => n + 1;
const g = valueOf;
const toString = (n: number): string => "<" + n + ">";
console.log(g(2), valueOf(3), toString(4));
const hasOwnProperty = (k: string): boolean => k === "a";
const h = hasOwnProperty;
console.log(h("a"), h("b"));
