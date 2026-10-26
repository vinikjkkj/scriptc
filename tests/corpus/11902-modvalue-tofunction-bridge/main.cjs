// The generate-function pattern as mysql2 uses it: the parser text is built
// line by line, then toFunction({ wrap, wrapNull, LocalDate }) turns it into a
// function. The generated row parser calls the native wrap closure, reads the
// module's constants, calls its functions, and returns Dates to native code.
const LocalDate = require('./local_date.cjs');
const generator = require('./gen.cjs');

function wrap(field, _this) {
  return { field, _this };
}

function wrapNull(v) {
  return v === null ? null : v;
}

const parserFn = generator();
parserFn.add('function (row) {');
parserFn.add('const result = [];');
for (let i = 0; i < 2; i++) {
  parserFn.add('LocalDate.checkTimezone();');
  parserFn.add('result.push(LocalDate.localDate(2001, 2, 3, 4, 5, 6, ' + i + '));');
}
parserFn.add('result.push(wrap(row[0], "t").field);');
parserFn.add('result.push(wrapNull(row[1]));');
parserFn.add('result.push(LocalDate.EPOCH_YEAR + LocalDate.MAX_CACHED);');
parserFn.add('result.push(typeof LocalDate.localDate);');
parserFn.add('return result;');
parserFn.add('}');

const parser = parserFn.toFunction({ wrap, wrapNull, LocalDate });
const row = parser([7, null]);
console.log(row.length, row[2], row[3], row[4], row[5]);
console.log(row[0] instanceof Date, row[1] instanceof Date, row[0].getTime() === new Date(2001, 1, 3, 4, 5, 6, 0).getTime());
console.log(parser([1, 2])[1].getTime() - parser([1, 2])[0].getTime());
