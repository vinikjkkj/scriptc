// A boolean let reassigned a number, then a string: each read follows the
// value's own type.
let flag = false;
console.log(flag, typeof flag);
flag = 2;
console.log(flag, typeof flag, flag * 4);
flag = 'yes';
console.log(flag, typeof flag, flag.length);
flag = !flag;
console.log(flag, typeof flag);
