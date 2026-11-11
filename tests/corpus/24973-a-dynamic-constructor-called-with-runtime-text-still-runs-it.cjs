// The other side of the staging: when the text is NOT a build-time constant, a constructor read that turns out to be the Function constructor
// really runs text, so the program still links the embedded engine and prints Node's answers (including the SyntaxError for bad text).
function sample() {}
const holder = {}
holder.fn = sample
holder.arr = JSON.parse('[1, 2]')
const text = JSON.parse('"return 40 + 2"')
const g = holder.fn.constructor(text)
console.log(g(), g.length, g.name)
const h = holder.fn.constructor('a', JSON.parse('"return a * 2"'))
console.log(h(21))
try { holder.fn.constructor(JSON.parse('"return +"')) } catch (e) { console.log(e instanceof SyntaxError, e.name) }
