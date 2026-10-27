// The range and type errors of the BigInt writes, with Node's messages.
var w = Buffer.alloc(8)
try { w.writeBigInt64LE(2n ** 63n, 0) } catch (e) { console.log(e.name, e.code, e.message) }
try { w.writeBigUInt64LE(-1n, 0) } catch (e) { console.log(e.name, e.code, e.message) }
try { w.writeBigInt64LE(5, 0) } catch (e) { console.log(e.name, e.message) }
console.log(w.writeBigInt64LE(-(2n ** 63n), 0), w.writeBigUInt64LE(2n ** 64n - 1n, 0))
