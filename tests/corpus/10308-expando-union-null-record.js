// A parser returns either a record or null (pg-types' point parser), and the caller
// writes a member onto the result. The write lands on the record arm.
var parsePoint = function (value) {
  if (value[0] !== '(') { return null; }
  value = value.substring(1, value.length - 1).split(',');
  return { x: parseFloat(value[0]), y: parseFloat(value[1]) };
};
var parseCircle = function (value) {
  var point = value.substring(0, value.indexOf('<'));
  var radius = value.substring(value.indexOf('<') + 1);
  var result = parsePoint(point);
  result.radius = radius;
  return result;
};
console.log(parseCircle('(1,2)<3.5'));
console.log(parseCircle('(4,5)<6').radius, parseCircle('(4,5)<6').x);
