// The safer.Buffer object is a plain object in Node: calling or constructing it throws.
var safer = require('./12450-safer-verbatim/safer.cjs')
try { safer.Buffer(3) } catch (e) { console.log(e instanceof TypeError, e.message) }
try { new safer.Buffer(3) } catch (e) { console.log(e instanceof TypeError, e.message) }
console.log(safer.Buffer.from('ok').toString(), typeof safer.Buffer)
