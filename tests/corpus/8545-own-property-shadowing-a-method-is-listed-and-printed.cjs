'use strict';
const util = require('util');
// pg's Result: the own `parseRow` exists only on instances built in array mode,
// shadows the prototype method, and sits between the fields assigned before and
// after it.
class Result {
  constructor(rowMode, tag) {
    this.command = null;
    this.rows = [];
    this.tag = tag;
    this.rowAsArray = rowMode === 'array';
    if (this.rowAsArray) {
      this.parseRow = this._parseRowAsArray;
    }
    this._prebuilt = null;
  }
  _parseRowAsArray(rowData) {
    const row = [];
    for (let i = 0; i < rowData.length; i++) row.push(this.tag + ':' + rowData[i]);
    return row;
  }
  parseRow(rowData) {
    return { tag: this.tag, n: rowData.length };
  }
  addRow(rowData) {
    this.rows.push(this.parseRow(rowData));
  }
}
const a = new Result('array', 'A');
const b = new Result('object', 'B');
a.addRow(['x', 'y']);
b.addRow(['x', 'y']);
console.log(Object.keys(a), Object.keys(b));
console.log(a);
console.log(b);
console.log(util.inspect(a, { depth: 0 }), util.inspect(b));
console.log([a, b]);
console.log({ held: a });
// Through an untyped parameter: the member table of the box.
function viaAny(x) {
  return [Object.keys(x).join(','), typeof x.parseRow, JSON.stringify(x.parseRow(['q']))];
}
console.log(viaAny(a));
console.log(viaAny(b));
console.log("parseRow" in a, "parseRow" in b, typeof a.parseRow, typeof b.parseRow);
