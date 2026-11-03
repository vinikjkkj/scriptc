/** @type {any} */ const o = {};
const ks = ["toString", "constructor", "hasOwnProperty", "valueOf", "nope", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"];
for (const k of ks) console.log(k, typeof o[k], !o[k], k in o);
o.own = 1;
for (const k of ["own", "toString"]) console.log(k, Object.prototype.hasOwnProperty.call(o, k), typeof o[k]);
/** @type {any} */ const d = Object.create(null);
for (const k of ks) console.log("null-proto", k, typeof d[k], k in d);
/** @type {any} */ const arr = [1];
for (const k of ["toString", "hasOwnProperty"]) console.log("arr", k, typeof arr[k]);
