// mysql2's getSecureContext shape: an untyped ssl config is built into a
// SecureContext once, cached in a WeakMap keyed by the config object, and
// the cache is hit on the second call while none of the material changed.
import tls from 'tls';
const secureContexts = new WeakMap();
function getSecureContext(ssl) {
  const cached = secureContexts.get(ssl);
  if (
    cached !== undefined &&
    cached.ca === ssl.ca &&
    cached.cert === ssl.cert &&
    cached.ciphers === ssl.ciphers &&
    cached.key === ssl.key &&
    cached.passphrase === ssl.passphrase &&
    cached.minVersion === ssl.minVersion &&
    cached.maxVersion === ssl.maxVersion
  ) {
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
  secureContexts.set(ssl, {
    secureContext,
    ca: ssl.ca,
    cert: ssl.cert,
    ciphers: ssl.ciphers,
    key: ssl.key,
    passphrase: ssl.passphrase,
    minVersion: ssl.minVersion,
    maxVersion: ssl.maxVersion,
  });
  return secureContext;
}
const CERT = `-----BEGIN CERTIFICATE-----
MIIB0jCCAXigAwIBAgIUQ5nO7P8omev2Wtrf+4VkXVcHca8wCgYIKoZIzj0EAwIw
GzEZMBcGA1UEAwwQdHNuYXRpdmUgdGVzdCBDQTAgFw0yNjA3MTYyMDM3MDhaGA8y
MTI2MDYyMjIwMzcwOFowFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0C
AQYIKoZIzj0DAQcDQgAE+Q5kA/xmP5NAsE5Iry7b3M6+2R+EDlMjYYAfGy8tY+Bm
1NbM/MS8rX5FWa5axU0LtFgID7zztcQs9kF18ACXrKOBnjCBmzAJBgNVHRMEAjAA
MAsGA1UdDwQEAwIFoDATBgNVHSUEDDAKBggrBgEFBQcDATAsBgNVHREEJTAjggls
b2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAAAAEwHQYDVR0OBBYEFEd3Olw5
l3MYObGKBheMvKX+obJeMB8GA1UdIwQYMBaAFPshJbeBgppdQm5lhrY6sPogFlsF
MAoGCCqGSM49BAMCA0gAMEUCIQCP7PdVl7Ypk341DahJ0clD8EyY20r3s2qgXI+l
56OBTwIga88H3XE/9nagiF1pNHG6LtP6cnykORufpW8/KKi9hm8=
-----END CERTIFICATE-----`;
const KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIBRbyFqnFoJ1Ptp+e85J1kZdfXOgZC3AVhuknG4vCdFHoAoGCCqGSM49
AwEHoUQDQgAE+Q5kA/xmP5NAsE5Iry7b3M6+2R+EDlMjYYAfGy8tY+Bm1NbM/MS8
rX5FWa5axU0LtFgID7zztcQs9kF18ACXrA==
-----END EC PRIVATE KEY-----`;
const ssl = { cert: CERT, key: KEY };
const first = getSecureContext(ssl);
const second = getSecureContext(ssl);
console.log('same handle:', first === second);
console.log('typeof:', typeof first);
const other = getSecureContext({ cert: CERT, key: KEY });
console.log('other config, other handle:', first !== other);
const rebuilt = getSecureContext(ssl);
console.log('still cached:', rebuilt === first);
