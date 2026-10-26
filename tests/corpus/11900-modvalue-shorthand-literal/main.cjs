// A required module's exports object is passed as a VALUE, inside a shorthand
// object literal, to a function that reads its members (mysql2's
// { wrap, wrapNull, LocalDate } scope shape). Functions and constants of the
// module are read through the scope and called from the receiving function.
const LocalDate = require('./local_date.cjs');

function wrap(field, self) {
  return '<' + field + '|' + self + '>';
}

function wrapNull(v) {
  return v === null ? 'NULL' : v;
}

function makeConverter(scope) {
  const { wrap, LocalDate } = scope;
  return function convert(row) {
    return [
      wrap(row, 'x'),
      wrapNull(null),
      LocalDate.localDate(2020, 2, 3, 4, 5, 6, 7).getTime(),
      LocalDate.EPOCH_YEAR,
      LocalDate.MAX_CACHED,
      typeof LocalDate.checkTimezone,
      LocalDate.usesLocalDate({ columnType: 'DATETIME' }),
    ];
  };
}

const conv = makeConverter({ wrap, wrapNull, LocalDate });
console.log(conv('a'));
console.log(conv('b').length, typeof LocalDate.localDate, Object.keys(LocalDate).length);
console.log(LocalDate.checkTimezone(), LocalDate._daysFromCivil(2000, 1, 1));
