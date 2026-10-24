// A small row-reader generator in the shape of mysql2's: one reader function per column list, text assembled from
// fixed fragments, names inlined as literals. The column list is fixed here, so the whole text is program-known up to
// the names.
function readerFor(a, b) {
  const lhsA = 'row[' + JSON.stringify(a) + ']';
  const lhsB = 'row[' + JSON.stringify(b) + ']';
  const src = [
    'var row = {};',
    lhsA + ' = src.next();',
    lhsB + ' = src.next() * 2;',
    'return row;',
  ].join('\n');
  return new Function('src', src);
}
function source(values) { let i = 0; return { next() { return values[i++]; } }; }
const r1 = readerFor('id', 'score');
console.log(r1(source([1, 21])), r1(source([2, 4])));
const r2 = readerFor('na"me', 'x y');
console.log(r2(source([3, 4])));
