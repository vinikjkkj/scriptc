"use strict";
const privateObjectProps = new Set(["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__"]);
const fieldEscape = (field, isEval = true) => {
  if (privateObjectProps.has(field)) {
    throw new Error(`The field name (${field}) can't be the same as an object's private property.`);
  }
  return field;
};
function getParser(fields, config) {
  const typeCast = config.typeCast;
  return class BinaryRow {
    constructor() {}
    next(packet, fields, options) {
      const nullBytes = new Array(Math.floor((fields.length + 7 + 2) / 8));
      for (let i = 0; i < nullBytes.length; i++) nullBytes[i] = 0;
      const result = options.rowsAsArray ? new Array(fields.length) : {};
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        let value = packet.vals[i];
        if (typeof typeCast === "function") value = typeCast(field, value);
        if (options.rowsAsArray) {
          result[i] = value;
        } else if (typeof options.nestTables === "string") {
          const key = fieldEscape(field.table + options.nestTables + field.name, false);
          result[key] = value;
        } else if (options.nestTables === true) {
          const tableName = fieldEscape(field.table, false);
          if (!result[tableName]) {
            result[tableName] = {};
          }
          const fieldName = fieldEscape(field.name, false);
          result[tableName][fieldName] = value;
        } else {
          const key = fieldEscape(field.name, false);
          result[key] = value;
        }
      }
      return result;
    }
  };
}
function cols(spec) { return spec.map((s) => { const p = s.split("."); return { table: p.length > 1 ? p[0] : "t", name: p[p.length - 1] }; }); }
function run(spec, vals, options, config) {
  const fields = cols(spec);
  const P = getParser(fields, config || {});
  const row = new (P)().next({ vals }, fields, options);
  return row;
}


const r1 = run(["id", "name", "age"], [1, "ann", 30], {});
console.log(r1); console.log(JSON.stringify(r1), Object.keys(r1), Array.isArray(r1), typeof r1);
const r2 = run(["z", "a", "m"], [null, true, 2.5], {});
console.log(r2, Object.entries(r2), "a" in r2, r2.m, r2.q, r2.hasOwnProperty("z"));
const r3 = run(["a", "a", "b"], [1, 2, 3], {});
console.log(r3, Object.keys(r3));
const rows = [];
for (let i = 0; i < 3; i++) rows.push(run(["n", "sq"], [i, i * i], {}));
console.log(rows, JSON.stringify(rows));
r1.extra = "x"; delete r1.id; console.log(r1, Object.keys(r1));
console.log(run([], [], {}), JSON.stringify(run([], [], {})));

