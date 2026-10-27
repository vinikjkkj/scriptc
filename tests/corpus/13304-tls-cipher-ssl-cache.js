import tls from 'tls';
// The mysql2 getSecureContext shape: an untyped ssl config (JSON), a WeakMap
// cache keyed by it, createSecureContext over the untyped members (ciphers
// included), and the context kept as a Map value and returned.
const secureContexts = new WeakMap();
function getSecureContext(ssl) {
  const cached = secureContexts.get(ssl);
  if (cached !== undefined && cached.ciphers === ssl.ciphers && cached.minVersion === ssl.minVersion) {
    return cached.secureContext;
  }
  const secureContext = tls.createSecureContext({
    ca: ssl.ca,
    cert: ssl.cert,
    ciphers: ssl.ciphers,
    key: ssl.key,
    passphrase: ssl.passphrase,
    minVersion: ssl.minVersion,
    maxVersion: ssl.maxVersion,
  });
  secureContexts.set(ssl, { secureContext, ciphers: ssl.ciphers, minVersion: ssl.minVersion });
  return secureContext;
}
const configs = [
  '{"ciphers":"ECDHE-RSA-AES128-GCM-SHA256"}',
  '{"ciphers":"TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256"}',
  '{"ciphers":"bogus"}',
  '{"ciphers":""}',
  '{"ciphers":7}',
  '{"minVersion":"TLSv1.2","maxVersion":"TLSv1.3"}',
  '{}',
];
const seen = [];
for (const text of configs) {
  const ssl = JSON.parse(text);
  try {
    const first = getSecureContext(ssl);
    const again = getSecureContext(ssl);
    seen.push(first);
    console.log(text, 'built', typeof first, first === again);
  } catch (e) {
    console.log(text, e.name, e.code, e.message);
  }
}
console.log('distinct contexts', new Set(seen).size, 'of', seen.length);
