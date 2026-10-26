// mysql2 binary_parser shape: a helper returns a fixed-key literal built from an untyped argument; the spread copies its keys into a literal with function members.
function fieldMetadata(field) {
  return {
    type: field.type,
    extendedTypeName: field.typeName,
    extendedFormat: field.format,
    length: field.length,
    db: field.db,
    table: field.table,
    name: field.name,
  };
}
function wrap(field, packet) {
  return {
    ...fieldMetadata(field),
    string: function () { return 'S:' + packet; },
    buffer: function () { return 'B:' + packet.length; },
    geometry: function () { return 'G:' + field.name; },
  };
}
const f = { type: 'VARCHAR', typeName: 'text', format: 0, length: 20, db: 'd', table: 't', name: 'n' };
const w = wrap(f, 'p1');
console.log(Object.keys(w).join(','));
console.log(JSON.stringify(w));
console.log(w.string(), w.buffer(), w.geometry());
for (const k in w) console.log(k, typeof w[k]);
const g = wrap({ name: 'x' }, 'pp');
console.log(JSON.stringify(g), Object.keys(g).length);
