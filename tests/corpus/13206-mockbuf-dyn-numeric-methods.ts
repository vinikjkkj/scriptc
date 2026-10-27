// Buffer numeric read/write methods on a DYNAMIC receiver (c: any): the call, the typeof, and `in` must all answer as they do on a static Buffer.
const c: any = Buffer.alloc(8);
console.log(c.writeUInt16LE(513, 0), c.readUInt16LE(0), c.readUInt8(0), c.readUInt8(1));
console.log(c.writeInt32BE(-2, 2), c.readInt32BE(2), c.readUint8(2));
console.log(c.writeDoubleLE(1.5, 0), c.readDoubleLE(0));
console.log(c.writeUIntBE(0x123456, 0, 3), c.readUIntBE(0, 3), c.readIntLE(0, 3));
console.log('readUInt8' in c, typeof c.readUInt8, typeof c.writeFloatBE, 'nope' in c);
console.log(c.readFloatBE(4), c.toString('hex'));
