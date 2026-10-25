// A class from a require used as a value in an object literal (shorthand and keyed), then constructed through it.
const Packet = require('./packet.cjs');
const Alias = require('./packet.cjs');
const ctorMap = { Packet, Other: Alias };
const p = new ctorMap.Packet(7);
console.log(p.v, p.double, ctorMap.Packet === Packet, ctorMap.Other === Packet, p instanceof Packet);
