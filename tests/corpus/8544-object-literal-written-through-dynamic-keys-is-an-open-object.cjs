'use strict';
const fieldNames = ['host', 'port', 'database', 'user', 'password'];
const passKey = fieldNames[fieldNames.length - 1];

function parseLine(line) {
  var obj = {};
  var idx = 0;
  var addToObj = function (i, value) {
    obj[fieldNames[i]] = value.trim();
  };
  line.split(':').forEach(function (part) {
    if (idx < fieldNames.length) addToObj(idx++, part);
  });
  obj = Object.keys(obj).length === fieldNames.length ? obj : null;
  return obj;
}
const entry = parseLine('db.example:5432:app: alice :s3cret');
console.log(entry, entry && entry[passKey], entry && entry.host);
console.log(parseLine('too:few'));

const positions = { years: 1, months: 2, days: 3 };
const matches = [null, '5', '0', '12'];
function parse(interval) {
  if (!interval) return {};
  return Object.keys(positions).reduce(function (parsed, property) {
    var position = positions[property];
    var value = matches[position];
    if (!value) return parsed;
    parsed[property] = parseInt(value, 10);
    return parsed;
  }, {});
}
console.log(parse(true), parse(false));
const interval = parse(true);
console.log(interval.years, interval.months, interval.days, Object.keys(interval));

// A counter map: compound assignment and increment through a dynamic key.
const counts = {};
for (const w of 'a b a c b a'.split(' ')) {
  counts[w] = (counts[w] || 0) + 1;
}
counts['z'] = 0;
counts[passKey]++;
console.log(counts);
delete counts[fieldNames[0] === 'host' ? 'z' : 'a'];
console.log(Object.keys(counts).join(','));

// A literal nobody writes through a dynamic key keeps its record shape.
const fixed = { a: 1, b: 2 };
fixed.a = 5;
console.log(fixed, fixed.a + fixed.b);
