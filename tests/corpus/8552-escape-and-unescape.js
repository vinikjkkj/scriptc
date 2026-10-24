// The Annex B escape / unescape globals over UTF-16 code units, called and
// held as values. They used to be refused (SC2001 at the call).
console.log(escape('a b+c/d@e*f_g-h.i'), escape('é€😀\n'), escape(''), escape('~!#$&()=?'));
console.log(unescape('%u20AC%E9%20x'), unescape('%zz%u12%u12G%'), unescape('%uD83D%uDE00|%uD83D|%41%4a'));
console.log(unescape(escape('round é€😀 trip')) === 'round é€😀 trip');
const e = escape, u = unescape;
console.log(typeof e, typeof u, e === escape, u === unescape, e('x y'), u('x%20y'));
