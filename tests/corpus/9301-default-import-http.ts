// Default import of node:http in a TypeScript source (no interop flags).
import http from 'node:http'

const server = http.createServer(() => {})
console.log(server !== null)
console.log(http.createServer(() => {}) !== null)
