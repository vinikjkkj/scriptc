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
const names = [];
for (let i = 0; i < 40; i++) names.push(i % 3 === 0 ? "c" + i : i % 3 === 1 ? String(100 - i) : "k_" + i);
const vals = names.map((n, i) => i * 1.5);
const r = run(names, vals, {});
console.log(Object.keys(r).join(","));
console.log(Object.keys(r).length, r.c0, r["99"], r.k_2);
delete r.c0; delete r["99"]; r.c0 = "again"; r["5"] = "five"; r["99"] = "back";
console.log(Object.keys(r).join(","));
const a = run(names, vals, { rowsAsArray: true });
console.log(a.length, a[39], a.slice(0, 4), a.reduce((s, v) => s + v, 0));
const t = run(names.map((n, i) => (i % 2 ? "even." : "odd.") + n), vals, { nestTables: true });
console.log(Object.keys(t), Object.keys(t.even).length, Object.keys(t.odd).length);
const rows = [];
for (let k = 0; k < 5; k++) rows.push(run(["id", "v"], [k, "r" + k], k % 2 ? { rowsAsArray: true } : {}));
console.log(rows);
