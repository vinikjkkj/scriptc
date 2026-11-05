// x?.[Symbol.toStringTag] over typed arrays, a DataView and a Buffer: the built-in tag of the value, as bson's byte utils ask it.
type NodeJsBuffer = ReturnType<typeof Buffer.from>;
function tag(potentialBuffer: Uint8Array | NodeJsBuffer | ArrayBuffer): string {
  if (Buffer.isBuffer(potentialBuffer)) {
    return "buffer";
  }
  if (ArrayBuffer.isView(potentialBuffer)) {
    return "view";
  }
  const stringTag =
    potentialBuffer?.[Symbol.toStringTag] ?? Object.prototype.toString.call(potentialBuffer);
  return stringTag;
}
function tag2(p: Uint8Array | Int16Array | DataView | ArrayBuffer): string {
  const stringTag = p?.[Symbol.toStringTag] ?? Object.prototype.toString.call(p);
  return stringTag;
}
console.log(tag(new Uint8Array(1)), tag(Buffer.alloc(1)), tag2(new Uint8Array(1)), tag2(new Int16Array(2)), tag2(new DataView(new Uint8Array(4).buffer)));
