// Uint16Array.from(uint8array) (a cross-kind copy) and the Array.from(view, fn) chain over it
// (the web_byte_utils toISO88591 shape): each element is a Number, stored through ToUint16.
function toLatin1(u8: Uint8Array): string {
  return Array.from(Uint16Array.from(u8), (b: number) => String.fromCharCode(b)).join('');
}
const src: Uint8Array = Uint8Array.from([0, 65, 127, 255]);
console.log(toLatin1(src).length, toLatin1(src).charCodeAt(3));
const wide: Uint16Array = Uint16Array.from(src);
console.log(Array.from(wide).join(","), wide.length, wide.BYTES_PER_ELEMENT);
wide[0] = 7;
console.log(src[0], wide[0]);
