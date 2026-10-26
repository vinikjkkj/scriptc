// the writeCompressedFrame shape (mysql2 compressed_protocol.js:103): null short-circuits, the other arm reads .length
function frameLen(packetLen, compressed) {
  const compressedLength = compressed === null ? packetLen : compressed.length;
  return compressedLength & 0xff;
}
function pick(n) {
  if (n === 0) return null;
  return undefined;
}
for (let i = 0; i < 2; i++) {
  try {
    console.log(frameLen(300, pick(i)));
  } catch (e) {
    console.log(e.name + ": " + e.message);
  }
}
