// Dates are objects with a numeric valueOf: relational operators convert them
// through ToPrimitive (number hint) and compare the time values.
function lt(a: any, b: any): boolean { return a < b; }
function ge(a: any, b: any): boolean { return a >= b; }
console.log(lt(new Date(1000), new Date(2000)), lt(new Date(2000), new Date(1000)), lt(new Date(1000), 2000), lt(999, new Date(1000)));
console.log(ge(new Date(5), 4), ge(new Date(5), 6), ge(new Date(5), new Date(5)));
