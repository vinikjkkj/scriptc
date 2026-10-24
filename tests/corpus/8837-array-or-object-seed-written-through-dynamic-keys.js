"use strict";
// A row built as `asArray ? [] : {}` and written through run-time keys (and pushed to) is one open object (mysql2's static text parser).
function rows(options, fields, values) {
  const result = options.rowsAsArray ? [] : {};
  for (let i = 0; i < fields.length; i++) {
    const value = values[i];
    if (options.rowsAsArray) {
      result.push(value);
    } else if (typeof options.nestTables === 'string') {
      result[fields[i].table + options.nestTables + fields[i].name] = value;
    } else if (options.nestTables) {
      const t = fields[i].table;
      if (!result[t]) result[t] = {};
      result[t][fields[i].name] = value;
    } else {
      result[fields[i].name] = value;
    }
  }
  return result;
}
const fields = [{ table: 't', name: 'a' }, { table: 't', name: 'b' }];
console.log(rows({ rowsAsArray: true }, fields, [1, 'x']));
console.log(rows({}, fields, [1, 'x']));
console.log(rows({ nestTables: '_' }, fields, [1, 'x']));
console.log(rows({ nestTables: true }, fields, [1, 'x']));
