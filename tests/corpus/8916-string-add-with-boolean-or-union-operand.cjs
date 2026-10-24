// `+` whose untyped side is a boolean-or-union value at run time (`name + (n++ || '')`).
function label(name, n) {
  return name + (n++ || '');
}
var c = 0;
console.log(label('a', c), label('b', c), label('c', c), c);
function pick(flag, text) {
  var v = flag && text;
  return 'x' + (v || false);
}
console.log(pick(true, 'yes'), pick(false, 'no'), pick(true, ''));
