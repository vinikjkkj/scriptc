// A sloppy function that reads `arguments.length` and also reassigns its own parameters. The length is the
// CALL's arity, which a parameter write never moves, so the arguments-bound form (declared parameters re-bound
// off the argument list) answers exactly what the alias would. generate-function's `property(obj, name)` is the
// shape: `if (arguments.length === 1) { name = obj; obj = ''; }`.
function property(obj, name) {
  if (arguments.length === 1) {
    name = obj;
    obj = '';
  }
  name = name + '';
  return obj ? obj + '.' + name : name;
}
console.log(property('a', 'b'), property('c'), property('x', 5));

var line = function () {};
line.join = function (head, tail) {
  if (arguments.length < 2) {
    tail = head;
    head = '>';
  }
  return head + tail;
};
console.log(line.join('p', 'q'), line.join('r'));

function arity(a, b, c) {
  var n = arguments.length;
  a = 1;
  b = 2;
  return n + ':' + a + b + String(c);
}
console.log(arity(), arity(9), arity(9, 9, 9), arity(1, 2, 3, 4));

var viaArrow = function (x, y) {
  var f = () => arguments.length;
  y = 'w';
  return f() + y + String(x);
};
console.log(viaArrow(), viaArrow(7), viaArrow(7, 8));
