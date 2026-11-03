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


let calls = 0;
const cast = (f, v) => { calls++; if (f.name === "boom" && v === "x") throw new RangeError("cast " + f.name); return v; };
const spec = ["a", "boom", "c"];
for (const o of [{}, { rowsAsArray: true }, { nestTables: true }]) {
  for (const v of ["ok", "x"]) {
    try {
      const r = run(spec, [1, v, 3], o, { typeCast: cast });
      console.log("row", JSON.stringify(r), Object.keys(r));
    } catch (e) {
      console.log("threw", e instanceof RangeError, e.message);
    }
  }
}
console.log(calls);
