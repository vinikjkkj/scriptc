// The same module object handed to a `new Function` whose body is built in a
// loop (not statically foldable): the body calls the module's functions and
// reads its constants, and the native wrap closure is called back from it.
const LocalDate = require('./local_date.cjs');

function wrap(v) {
  return 'w:' + v;
}

const scope = { wrap, LocalDate };
let body = '';
for (let i = 0; i < 3; i++) body += 'LocalDate.checkTimezone();\n';
body += 'const res = [];\n';
for (let i = 0; i < 2; i++) body += 'res.push(wrap(' + (i + 1) + '));\n';
body += 'res.push(LocalDate.EPOCH_YEAR);\n';
body += 'res.push(LocalDate.MAX_CACHED);\n';
body += 'res.push(typeof LocalDate.usesLocalDate);\n';
body += 'res.push(LocalDate.usesLocalDate({ columnType: "DATETIME" }));\n';
body += 'res.push(LocalDate._daysFromCivil(2000, 1, 1));\n';
body += 'LocalDate._clear();\n';
body += 'res.push(LocalDate.localDate(2021, 5, 6, 7, 8, 9, 10).getTime() > 0);\n';
body += 'return res;';
const gen = new Function('wrap', 'LocalDate', body);
const out = gen(scope.wrap, scope.LocalDate);
console.log(JSON.stringify(out));
console.log(out.length, out[0], out[2]);
