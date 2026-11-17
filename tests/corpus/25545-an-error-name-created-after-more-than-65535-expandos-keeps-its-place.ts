// The recorded creation position of `name` overflows its 16-bit slot here: the order must still be exact, through a delete too.
class Tagged extends Error {}
const t = new Tagged('m') as any;
for (let i = 0; i < 66000; i++) t['k' + i] = i;
t.name = 'N';
t.after = 1;
const k1 = Object.keys(t);
console.log(k1.length, k1[65999], k1[66000], k1[66001], k1.indexOf('name'));
delete t.k5;
const k2 = Object.keys(t);
console.log(k2.length, k2[65998], k2[65999], k2[66000], k2.indexOf('name'));
t.message = 'x';
console.log(Object.keys(t).length, Object.keys(t).indexOf('name'));
