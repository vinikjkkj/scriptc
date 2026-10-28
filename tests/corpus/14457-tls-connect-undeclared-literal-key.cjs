'use strict';
// tls.connect's options record does not declare isServer, and Node's connect()
// builds its TLSSocket with its own isServer: false, so a caller's isServer is
// never read: this client still connects as a client. The compiled literal
// drops the key only because the callee table (lower-server.ts,
// TLS_CONNECT_IGNORED_KEYS) names it. Node's behaviour is pinned here.
const fs = require('fs');
const tls = require('tls');
const key = fs.readFileSync('tests/fixtures/server/certs/localhost-key.pem');
const cert = fs.readFileSync('tests/fixtures/server/certs/localhost.pem');
const ca = fs.readFileSync('tests/fixtures/server/certs/ca.pem');
const srv = tls.createServer({ key, cert }, (s) => { s.on('error', () => {}); s.end(); });
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port;
  const s = tls.connect({ host: 'localhost', port, ca, isServer: true }, () => {
    console.log('secure client', s.authorized);
    s.end();
  });
  s.on('error', (e) => { console.log('error', e.message); });
  s.on('close', () => srv.close());
});
