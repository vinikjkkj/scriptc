// postgres-interval's parse: a (string | null) var given parseInt's number. The slot was the
// union of the initializer and the store threw at run time; Node prints the object.
const positions = { years: 1, months: 2, days: 3 };
const matches = [null, '5', '0', '12'];
function parse(interval) {
  if (!interval) return {};
  return Object.keys(positions).reduce(function (parsed, property) {
    var position = positions[property];
    var value = matches[position];
    if (!value) return parsed;
    value = parseInt(value, 10);
    if (!value) return parsed;
    parsed[property] = value;
    return parsed;
  }, /** @type {any} */ ({}));
}
console.log(parse(true), parse(false));
const o = parse(true);
console.log(o.years, o.months, o.days, Object.keys(o));
