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


const r = run(["b", "2", "a", "1", "10", "01", "-1", "1.5", "4294967294", "4294967295", "9007199254740993", "0"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], {});
console.log(r); console.log(Object.keys(r)); console.log(JSON.stringify(r));
console.log(Object.values(r), r[1], r["1"], r[2], r["01"], r[10]);
for (const k in r) console.log("k", k, r[k]);
const n = run(["9.b", "9.1", "x.0", "9.0", "x.7"], ["a", "b", "c", "d", "e"], { nestTables: true });
console.log(n, Object.keys(n), Object.keys(n[9]));
const s = run(["a.2", "a.1"], [1, 2], { nestTables: "" });
console.log(s, Object.keys(s));

