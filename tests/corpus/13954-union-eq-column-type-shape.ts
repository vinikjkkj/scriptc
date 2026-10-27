// The shape of a column-type comparison: a union of a number tag, a
// missing value and a string tag, compared against tags with ===.
const Types = { DATETIME: 0x0c, TIMESTAMP: 0x07, STRING: 0xfd };
function isStampType(columnType: number | string | undefined): boolean {
  return columnType === Types.DATETIME || columnType === Types.TIMESTAMP;
}
function label(columnType: number | null): string {
  return columnType === Types.DATETIME ? 'datetime' : columnType === null ? 'none' : 'other';
}
console.log(isStampType(12), isStampType(7), isStampType(253), isStampType('12'));
console.log(isStampType(undefined), isStampType(0x0c), isStampType(0x0c + 0));
console.log(label(12), label(null), label(7), label(0));
let seen = 0;
const cols: Array<number | string | undefined> = [12, '12', undefined, 7, 'x'];
for (const c of cols) {
  if (c === Types.DATETIME) seen += 1;
  if (c === undefined) seen += 10;
}
console.log(seen);
