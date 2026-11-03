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


const r = run(["constructor", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf", "length", "name"], [1, 2, 3, 4, 5, 6, 7], {});
console.log(r); console.log(Object.keys(r), JSON.stringify(r), typeof r.constructor, r.toString, r.length);
const q = run(["a", "b"], [1, 2], {});
console.log(typeof q.toString, typeof q.constructor, String(q), q + "", `${q}`);
const s = run(["constructor.x", "t.y"], [1, 2], { nestTables: "." });
console.log(s, Object.keys(s));
let threw = false;
try { run(["__proto__"], [1], {}); } catch (e) { threw = true; console.log(e instanceof Error, e.message); }
console.log(threw);
for (const bad of ["__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]) {
  try { run([bad], [1], {}); console.log("no throw", bad); } catch (e) { console.log(e.message); }
}
try { run(["__proto__.x"], [1], { nestTables: true }); } catch (e) { console.log(e.message); }
console.log(run(["__proto__.x"], [1], { nestTables: "_" }));
console.log(run(["a.__proto__"], [1], { nestTables: "" }) !== null);

