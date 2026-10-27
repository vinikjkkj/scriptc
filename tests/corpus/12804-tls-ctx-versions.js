import tls from 'tls';
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
// minVersion and maxVersion: every version string Node accepts builds a
// context (including a min above the max), and each invalid string answers
// Node's ERR_TLS_INVALID_PROTOCOL_VERSION.
const show = (label, fn) => {
  try { fn(); console.log(label, 'ok'); } catch (e) { console.log(label, e.name, e.code, e.message); }
};
function build(ssl) {
  return tls.createSecureContext({ cert: ssl.cert, key: ssl.key, minVersion: ssl.minVersion, maxVersion: ssl.maxVersion });
}
const versions = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
for (const v of versions) {
  const o = JSON.parse(JSON.stringify({ cert: CERT, key: KEY, minVersion: v, maxVersion: v }));
  show('pinned ' + v, () => build(o));
}
show('min above max', () => build(JSON.parse(JSON.stringify({ cert: CERT, key: KEY, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.2' }))));
show('min only', () => build(JSON.parse(JSON.stringify({ cert: CERT, key: KEY, minVersion: 'TLSv1.2' }))));
show('max only', () => build(JSON.parse(JSON.stringify({ cert: CERT, key: KEY, maxVersion: 'TLSv1.2' }))));
show('bad min', () => build(JSON.parse(JSON.stringify({ cert: CERT, key: KEY, minVersion: 'TLSv1.4' }))));
show('bad max', () => build(JSON.parse(JSON.stringify({ cert: CERT, key: KEY, maxVersion: 'SSLv3' }))));
