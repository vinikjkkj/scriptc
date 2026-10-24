// A run-time string inlined into the text as a literal through JSON.stringify (the generate-function / mysql2 idiom).
function getter(name) {
  return new Function('o', 'return o[' + JSON.stringify(name) + ']');
}
const names = ['plain', 'with space', 'quo"te', "it's", 'back\\slash', 'line\nbreak', 'tab\t', 'café', ' sep', 'emoji😀', ''];
const o = {};
for (const n of names) o[n] = n.length;
for (const n of names) console.log(JSON.stringify(n), getter(n)(o));
console.log(getter('missing')({}));

function setter(name) {
  return new Function('o', 'v', `o[${JSON.stringify(name)}] = v; return o;`);
}
console.log(setter('k')({ z: 1 }, 7), setter('a b')({}, 'x'));

// two holes, one of them reached through a const binding
function pair(a, b) {
  const first = JSON.stringify(a);
  return new Function('return [' + first + ', ' + JSON.stringify(b) + '].join("|")');
}
console.log(pair('x', 'y')(), pair('1|2', 'c"d')());

// the hole is evaluated when the Function expression would have run
let calls = 0;
function key() { calls++; return 'k' + calls; }
const h1 = new Function('o', 'return o[' + JSON.stringify(key()) + ']');
const h2 = new Function('o', 'return o[' + JSON.stringify(key()) + ']');
console.log(calls, h1({ k1: 'one', k2: 'two' }), h2({ k1: 'one', k2: 'two' }));
