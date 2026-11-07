// mysql2 ColumnDefinition shape: accessor families installed by a helper (`Object.defineProperty(C.prototype, name, { get })`) on a class
// that ALSO gets computed prototype writes (one cache key per name), and a declared getter that reads one of the installed accessors.
class ColumnDefinition {
  constructor() { this.raw = { catalog: "def", schema: "db1", table: "t" }; }
  get db() { return this.schema; }
  inspect() { return { catalog: this.catalog, schema: this.schema, db: this.db, table: this.table }; }
}
const addString = function (name) {
  const cacheKey = `_${name}Value`;
  ColumnDefinition.prototype[cacheKey] = undefined;
  Object.defineProperty(ColumnDefinition.prototype, name, {
    get: function () {
      return "v:" + name + this.raw.table;
    },
  });
};
addString("catalog");
addString("schema");
addString("table");
const c = new ColumnDefinition();
console.log(JSON.stringify(c.inspect()), c.db, c.catalog);
