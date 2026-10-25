// A class bound by a destructuring require from a member export, passed to a helper that constructs through it.
const { Packet } = require('./packet.cjs');
function make(C, n) { return new C(n); }
const made = make(Packet, 3);
console.log(made.v, made.double, make(Packet, 5).double, typeof Packet);
