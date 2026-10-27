var api = require('./exporter.cjs')
console.log(api.Buffer.from('x'), api.Buffer.tag, api.size)
var B = require('./exporter.cjs').Buffer
console.log(B.from('y'), typeof B.from)
