// A JavaScript `var`/`let` is not typed by its initializer: Node stores whatever
// is assigned. The slot used to be the initializer's type, and the first store of
// another kind threw "not representable in the target union" at run time.
const matches = [null, '5', '0', '12'];

// (string | null) then a number (postgres-interval's parse).
function parseAll() {
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    var value = matches[i];
    if (!value) { out.push('skip'); continue; }
    value = parseInt(value, 10);
    out.push(value + 1);
  }
  return out;
}
console.log(parseAll());

// a plain string slot that later holds a number, and the reverse
function kinds(text) {
  var a = text;
  a = a.length;
  var b = 10;
  b = String(b) + '!';
  var c = true;
  c = 'yes';
  return [a, b, c, typeof a, typeof b, typeof c];
}
console.log(kinds('abcd'));

// the store happens in a closure
function viaClosure() {
  let n = 'x';
  const bump = () => { n = 41; };
  bump();
  return n + 1;
}
console.log(viaClosure());

// controls: same kind, no pin needed
function same() {
  var s = 'a';
  s = s + 'b';
  var k = 1;
  k = k * 2;
  return [s, k];
}
console.log(same());
