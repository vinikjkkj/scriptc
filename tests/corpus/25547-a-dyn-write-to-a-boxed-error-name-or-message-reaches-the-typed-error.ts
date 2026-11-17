// The reverse of 25546: `a` is the typed error boxed into `any`; writing name/message through it is the same object Node has.
const pe = new Error('x');
const a: any = pe;
a.name = 'Q';
console.log(pe.name, a.name, String(pe));
a.message = 'm2';
console.log(pe.message, a.message, String(pe));
const q = new TypeError('t');
const b: any = q;
b.name = 'TypeError';
b.k = 1;
console.log(Object.keys(q).join(','), q.name, b.name);
console.log(q instanceof TypeError, pe.name === a.name);
