// The client-first message and the nonce check of a SCRAM exchange: the
// header is chosen from the channel-binding flag, the nonce is composed
// with the server's, and the server nonce must start with the client's.
function clientFirst(nonce: string, stream: boolean, plus: boolean): { mech: string; msg: string } {
  const gs2 = plus ? 'p=tls-server-end-point' : stream ? 'y' : 'n'
  const mech = plus ? 'SCRAM-SHA-256-PLUS' : 'SCRAM-SHA-256'
  return { mech, msg: gs2 + ',,n=*,r=' + nonce }
}
function serverNonceOk(client: string, server: string): boolean {
  if (!server.startsWith(client)) return false
  return server.length !== client.length
}
const a = clientFirst('abcDEF123', false, false)
console.log(a.mech, a.msg)
const b = clientFirst('zz', true, true)
console.log(b.mech, b.msg)
console.log(serverNonceOk('abc', 'abcXYZ'), serverNonceOk('abc', 'abc'), serverNonceOk('abc', 'xbcabc'))
