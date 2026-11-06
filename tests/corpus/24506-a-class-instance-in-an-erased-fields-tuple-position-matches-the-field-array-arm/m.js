class Row { constructor(v) { this.key_id = v; } }
class ColumnDefinition {
  constructor(n) { this.name = n; this.flags = 0; this.decimals = 0; this._n = n; }
  get catalog() { return "def"; }
  get table() { return "t"; }
  get orgTable() { return "t"; }
  get orgName() { return this._n; }
}
export function execute(_sql, _v) {
  return new Promise((resolve) => {
    resolve([[], [new ColumnDefinition("key_id"), new ColumnDefinition("key_data")]]);
  });
}

