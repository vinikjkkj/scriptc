// typeof and member reads at each stage of one binding's life:
// number, then string, then the string concatenated with a number, then a
// number again through multiplication.
let x = 1;
console.log(typeof x, x + 1);
x = 'two';
console.log(typeof x, x.length, x.toUpperCase());
x = x + 1;
console.log(typeof x, x, x.length);
x = x * 2;
console.log(typeof x, x, x !== x);
