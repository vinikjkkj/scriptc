// pg's Result: `this.parseRow = this._parseRowAsArray` defines an own property
// that shadows the prototype method for that instance only; calls through
// `this.parseRow(...)` run the sibling method with the same receiver.
'use strict';
class Result {
  constructor(rowMode, tag) {
    this.tag = tag;
    this.rows = [];
    this.rowAsArray = rowMode === 'array';
    if (this.rowAsArray) {
      this.parseRow = this._parseRowAsArray;
    }
  }
  _parseRowAsArray(rowData) {
    const row = [];
    for (let i = 0; i < rowData.length; i++) row.push(this.tag + ':' + rowData[i]);
    return row.join('|');
  }
  parseRow(rowData) {
    return this.tag + '#' + rowData.length + '#' + rowData[0];
  }
  addRow(rowData) {
    this.rows.push(this.parseRow(rowData));
  }
}
const a = new Result('array', 'A');
const b = new Result('object', 'B');
a.addRow(['x', 'y']);
b.addRow(['x', 'y']);
a.addRow(['z']);
console.log(a.rows.join(' / '));
console.log(b.rows.join(' / '));
console.log(a.parseRow(['q', 'r']), b.parseRow(['q', 'r']));
console.log(a.rowAsArray, b.rowAsArray, Object.keys(b).join(','));
