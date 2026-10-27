// A string-keyed write onto a STATICALLY typed Buffer installs an own method on that one value. Calls on that value run the own function (statement and expression positions); a sibling Buffer keeps the native method.
const b = Buffer.alloc(2);
const other = Buffer.alloc(2);
const key = 'readUInt8';
b[key] = function () { return 42; };
console.log(b.readUInt8(0));
console.log(other.readUInt8(0));
other.writeUInt8(7, 1);
console.log(other.readUInt8(1));
b.writeUInt8(9, 0);
console.log(other.readUInt8(0));
