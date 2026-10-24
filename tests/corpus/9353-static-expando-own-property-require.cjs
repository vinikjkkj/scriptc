'use strict';
// The same expando memo as 9352, in a required CJS module: the requirer reads the static through the exported class, and the module's own writes are the storage it reads back.
const Packet = require('./9353-static-expando-own-property-modules/packet.cjs');
console.log(Packet.lengthCodedNumberLength(10), Packet._mockBuffer === undefined);
const b = Packet.MockBuffer();
console.log(b.length, Packet.MockBuffer() === b, Packet._mockBuffer === b, typeof b[0]);
