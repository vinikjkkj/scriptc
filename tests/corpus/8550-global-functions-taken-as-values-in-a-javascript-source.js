// A global function is a function in Node wherever it flows: held in a
// variable, a record, an array, a Set, passed to a helper. It used to be the
// identity token string (typeof 'string', "f is not a function", or a slot
// refusing the string at run time).
const fns = {
  parseInt, parseFloat, isNaN, isFinite, encodeURI, encodeURIComponent, decodeURI,
  decodeURIComponent, escape, unescape, atob, btoa,
};
console.log(typeof fns.parseInt, typeof fns.parseFloat, typeof fns.isNaN, typeof fns.isFinite, typeof fns.encodeURI, typeof fns.encodeURIComponent, typeof fns.decodeURI, typeof fns.decodeURIComponent, typeof fns.escape, typeof fns.unescape, typeof fns.atob, typeof fns.btoa);
console.log(fns.parseInt('42'), fns.parseInt('ff', 16), fns.parseInt('0x1f'), fns.parseFloat('1.5e2x'));
console.log(fns.isNaN(NaN), fns.isNaN(3), fns.isFinite(7), fns.isFinite(Infinity));
console.log(fns.encodeURI('a b/é'), fns.encodeURIComponent('a b&c'), fns.encodeURIComponent(12), fns.encodeURIComponent(true));
console.log(fns.decodeURI('a%20b%2F'), fns.decodeURIComponent('a%20b%2F'));
console.log(fns.escape('a b+c/é€😀'), fns.unescape('%u20AC%E9%20x%zz%u12'), fns.escape(''), fns.unescape('no escapes'));
console.log(fns.btoa('hi there'), fns.atob(fns.btoa('hi there')));

// identity: one global, one function
console.log(parseInt === parseInt, fns.parseInt === parseInt, fns.atob === atob, fns.escape === escape);
const known = new Set([setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate, queueMicrotask, structuredClone]);
console.log(known.has(setTimeout), known.has(clearInterval), known.has(structuredClone), known.has(parseInt), known.size);
const t = setTimeout;
console.log(t === setTimeout, typeof t, typeof clearTimeout, typeof structuredClone, typeof queueMicrotask);

// calls through a function parameter, an array element
function apply1(fn, x) { return fn(x); }
console.log(apply1(parseInt, '99'), apply1(escape, 'q r'), apply1(atob, 'aGk='), ['a b', 'c&d'].map(encodeURIComponent));

// timers through values: arguments ride along, clears work
const order = [];
const setT = setTimeout, setI = setInterval, setM = setImmediate, clrT = clearTimeout, clrI = clearInterval, clrM = clearImmediate;
setM((a, b) => order.push('imm ' + a + b), 'x', 'y');
const dropped = setM(() => order.push('never imm'));
clrM(dropped);
queueMicrotask(() => order.push('micro'));
const gone = setT(() => order.push('never timeout'), 5);
clrT(gone);
setT((a, b, c) => order.push('timeout ' + a + b + c), 3, 1, 2, 3);
let n = 0;
const iv = setI((tag) => {
  n++;
  order.push('tick ' + tag + n);
  if (n === 2) {
    clrI(iv);
    const copy = structuredClone({ a: [1, 2, { b: 3 }], d: 'x' });
    console.log(order.join(' | '), JSON.stringify(copy));
  }
}, 4, 'T');
console.log('sync end');
