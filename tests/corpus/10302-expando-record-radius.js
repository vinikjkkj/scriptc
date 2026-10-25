// A parser returns an object literal and then writes a member its literal never
// declared (pg-types' circle parser). The expando is read back by the caller.
function parsePoint(value) {
  value = value.substring(1, value.length - 1).split(',');
  return { x: parseFloat(value[0]), y: parseFloat(value[1]) };
}
function parseCircle(value) {
  var point = value.substring(1, value.indexOf('<'));
  var radius = parseFloat(value.substring(value.indexOf('<') + 1));
  var result = parsePoint(point);
  result.radius = radius;
  return result;
}
var c = parseCircle('(1,2)<3.5');
console.log(c.x, c.y, c.radius);
console.log(parseCircle('(4,5)<6').radius);
console.log(c);
console.log(Object.keys(c).join(','));
