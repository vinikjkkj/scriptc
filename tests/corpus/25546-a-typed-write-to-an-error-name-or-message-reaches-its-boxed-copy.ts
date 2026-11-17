// A plain Error boxed into `any` is a copy: a typed write afterwards has to be seen through it, and in a later Object.keys of the typed value.
const pe = new Error('x');
const a: any = pe;
console.log(a.name, a.message, Object.keys(a).join(','));
pe.name = 'P';
console.log(a.name, a.message, Object.keys(a).join(','), pe.name);
pe.message = 'm2';
console.log(a.name, a.message, Object.keys(a).join(','), pe.message);
const q = new Error();
console.log(Object.keys(q).join(','));
q.name = 'Q';
console.log(Object.keys(q).join(','), JSON.stringify(Object.entries(q)));
q.message = 'late';
console.log(Object.keys(q).join(','), JSON.stringify(Object.entries(q)));
