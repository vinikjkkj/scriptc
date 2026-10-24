// Element writes whose VALUE is used: `vars[name]++` on an object keyed by a computed name (generate-function's
// symbol counter), `(a[i] = v)`, `(a[i] += v)`, `++a[i]` and `a[i]--` as operands, over an object used as a table,
// an array, and a typed array.
function counter() {
  var vars = {};
  return function (name) {
    if (!vars[name]) vars[name] = 0;
    return String(name) + String(vars[name]++ || '');
  };
}
var sym = counter();
console.log(sym('a'), sym('a'), sym('b'), sym('a'), sym('b'));

var table = {};
var k = 'hits';
table[k] = 1;
console.log(table[k]++, table[k], ++table[k], table[k]--, --table[k], table[k]);
console.log((table[k] += 10), (table[k] -= 3), (table[k] *= 2), table[k]);
console.log((table['fresh'] = 'v'), table.fresh);

var xs = [10, 20, 30];
var i = 1;
console.log(xs[i]++, xs[i], ++xs[i], xs[i]--, --xs[i], xs[i]);
console.log((xs[0] += 5), (xs[2] = 99), xs.join(','));
console.log(xs[i++]++, i, xs.join(','));
var next = 0;
function pick() { return next++; }
console.log(xs[pick()]++, xs[pick()]++, next, xs.join(','));

var bytes = new Uint8Array(3);
bytes[0] = 255;
console.log(bytes[0]++, bytes[0], ++bytes[1], bytes[1], (bytes[2] = 300), bytes[2]);

var total = 0;
for (var j = 0; j < 4; j++) total += xs[j % 3]++;
console.log(total, xs.join(','));

var chain = [0, 0];
var a = (chain[0] = chain[1] = 7);
console.log(a, chain.join(','));
