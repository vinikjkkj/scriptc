// The same widening at FILE scope: a top-level let initialised with a number
// and reassigned a string, read through .length and concatenation.
let s = 0;
s = 'abc';
console.log(s.length, s);
let t = 0;
t = 'x' + 5;
console.log(t, typeof t, t.length);
t = t.length * 3;
console.log(t, typeof t);
