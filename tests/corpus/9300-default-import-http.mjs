// Default import of node:http: the default binding is the module object,
// so its members lower exactly like the namespace form.
import http from 'node:http'

const server = http.createServer(() => {})
console.log(server !== null)
console.log(http.createServer(() => {}) !== null)
