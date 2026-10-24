// Default import of node:https in TypeScript, and the runtime-chosen
// transport of WaMediaTransferClient.httpRequest: a block-scoped const
// conditional over the two default bindings, then a member call through it.
// Only the plain-http arm runs here (the https arm needs real TLS material).
import http from 'node:http'
import https from 'node:https'

function make(url: string): boolean {
  const protocol: string = url.slice(0, 6)
  const transport = protocol === 'https:' ? https : http
  const server = transport.createServer({ key: 'k', cert: 'c' }, () => {})
  return server !== null
}
console.log(make('http://example.invalid/'))
