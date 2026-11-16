// The literal spells an order the declared interface disagrees with AND spreads a member the interface does not declare: the
// order is the spelling's and the extra member stays.
interface Base { x: string; y: string; extra?: string }
interface Decl { readonly y: string; readonly x: string; readonly z: string }
function base(s: string): Base { return { x: 'x' + s, y: 'y' + s, extra: 'E' + s }; }
function build(s: string): Decl { const b = base(s); return { z: 'z' + s, ...b }; }
function send(p: unknown): string { return JSON.stringify(p); }
console.log(send(build('1')));
const d = build('2');
console.log(Object.keys(d).join(','));
console.log(JSON.stringify(Object.entries(d)));
console.log(d);
