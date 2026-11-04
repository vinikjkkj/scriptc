'use strict';
// Shaped like a database driver's packet classes: a write answers a ResultSetHeader instance, a
// read answers row instances and column-definition instances with accessor properties.
class ResultSetHeader {
  constructor(affectedRows, insertId) {
    this.fieldCount = 0;
    this.affectedRows = affectedRows;
    this.insertId = insertId;
    this.info = '';
    this.serverStatus = 2;
    this.warningStatus = 0;
  }
}
class ColumnDefinition {
  constructor(name, table) {
    this._name = name;
    this._table = table;
  }
  get name() {
    return this._name;
  }
  get table() {
    return this._table;
  }
  inspectName() {
    return this._table + '.' + this._name;
  }
}
class TextRow {
  constructor(id, label) {
    this.id = id;
    this.label = label;
  }
}
function execute(kind) {
  if (kind === 'write') {
    return Promise.resolve([new ResultSetHeader(2, 99), []]);
  }
  return Promise.resolve([
    [new TextRow(1, 'one'), new TextRow(2, 'two')],
    [new ColumnDefinition('id', 'rows'), new ColumnDefinition('label', 'rows')],
  ]);
}
export { execute };
