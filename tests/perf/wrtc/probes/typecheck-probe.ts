import { createSocket } from 'node:dgram'
// setBroadcast exists in @types/node's dgram.Socket but NOT in scriptc's
// fallback declarations. If this typechecks, @types/node is the type
// surface; if it says "property does not exist", the fallback is.
const s = createSocket('udp4')
s.setBroadcast(true)
console.log('ok')
