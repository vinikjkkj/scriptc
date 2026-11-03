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


const n1 = run(["a.id", "a.name", "b.id"], [1, "x", 2], { nestTables: true });
console.log(n1); console.log(JSON.stringify(n1), Object.keys(n1), Object.keys(n1.a), n1.b.id);
const n2 = run(["u.z", "t.y", "u.a", "t.x"], [1, 2, 3, 4], { nestTables: true });
console.log(n2, Object.keys(n2), Object.keys(n2.u), Object.keys(n2.t));
const n3 = run(["a.v", "a.v"], [1, 2], { nestTables: true });
console.log(n3);
const n4 = run(["1.x", "2.y", "1.z"], ["p", "q", "r"], { nestTables: true });
console.log(n4, Object.keys(n4));
console.log(JSON.stringify(run([], [], { nestTables: true })));

