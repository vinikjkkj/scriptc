// readDateTimeString shape: a column type that is a union of a numeric tag
// and an absent value, read through a helper with a strict tag compare.
const Types = { DATETIME: 0x0c, TIMESTAMP: 0x07 };
function readDateTimeString(length: number, columnType: number | undefined): string {
  let str = '2026-10-27';
  if (length > 6) {
    str += ' 10:00:00';
  } else if (columnType === Types.DATETIME || columnType === Types.TIMESTAMP) {
    str += ' 00:00:00';
  }
  return str;
}
console.log(readDateTimeString(3, 12));
console.log(readDateTimeString(3, 7));
console.log(readDateTimeString(3, undefined));
console.log(readDateTimeString(3, 0x0a));
console.log(readDateTimeString(9, 12));
