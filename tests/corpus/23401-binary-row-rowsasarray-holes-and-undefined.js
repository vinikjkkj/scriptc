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


const a1 = run(["id", "name", "age"], [1, "ann", 30], { rowsAsArray: true });
console.log(a1, a1.length, Array.isArray(a1), JSON.stringify(a1), Object.keys(a1), 1 in a1);
const a2 = run(["x", "y", "z"], [undefined, null, 0], { rowsAsArray: true });
console.log(a2, a2.length, JSON.stringify(a2), 0 in a2, a2[0] === undefined);
a2.forEach((v, i) => console.log("fe", i, v));
console.log(a2.map((v) => typeof v), a2.join("|"));
a2.push("tail"); console.log(a2, a2.length);
const a3 = run([], [], { rowsAsArray: true });
console.log(a3, a3.length, JSON.stringify(a3), Array.isArray(a3));
const a4 = run(["q"], [{ k: [1, 2] }], { rowsAsArray: true });
console.log(a4, a4[0].k[1]);
const [p, q] = run(["p", "q"], ["P", "Q"], { rowsAsArray: true });
console.log(p, q);

