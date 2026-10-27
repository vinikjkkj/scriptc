// Optional members the mysql2 ssl config leaves unset (undefined) build the
// same context as the cert and key alone; a set ca is accepted at the
// boundary (the walk's inert-on-server rule), and a wrong ca type throws
// Node's ERR_INVALID_ARG_TYPE.
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
const config = { ca: undefined, cert: CERT, ciphers: undefined, key: KEY, passphrase: undefined, minVersion: undefined, maxVersion: undefined };
const ctx = tls.createSecureContext(config);
console.log('built:', ctx !== undefined);
try {
  tls.createSecureContext({ ca: 42, cert: CERT, key: KEY });
  console.log('ca number: ok');
} catch (e) {
  console.log('ca number:', e.name, e.code, e.message);
}
