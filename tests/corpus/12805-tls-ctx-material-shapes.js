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
// The material shapes Node accepts for cert, key and ca: a string, a Buffer,
// an array (a chain for cert, the last entry for key, a bundle for ca); a
// lone cert or key; an empty list; null. Each builds a context.
const show = (label, fn) => {
  try { fn(); console.log(label, 'ok'); } catch (e) { console.log(label, e.name, e.code, e.message); }
};
show('cert only', () => tls.createSecureContext({ cert: CERT }));
show('key only', () => tls.createSecureContext({ key: KEY }));
show('ca only', () => tls.createSecureContext({ ca: CERT }));
show('empty options', () => tls.createSecureContext({}));
show('buffers', () => tls.createSecureContext({ cert: Buffer.from(CERT), key: Buffer.from(KEY), ca: Buffer.from(CERT) }));
show('cert chain', () => tls.createSecureContext({ cert: [CERT, CERT], key: KEY }));
show('cert chain mixed', () => tls.createSecureContext({ cert: [Buffer.from(CERT), CERT], key: KEY }));
show('key array', () => tls.createSecureContext({ cert: CERT, key: [KEY, KEY] }));
show('ca bundle', () => tls.createSecureContext({ ca: [CERT, Buffer.from(CERT)], cert: CERT, key: KEY }));
show('ca empty list', () => tls.createSecureContext({ ca: [], cert: CERT, key: KEY }));
show('cert empty list', () => tls.createSecureContext({ cert: [], key: KEY }));
show('nulls', () => tls.createSecureContext({ ca: null, cert: CERT, key: null }));
