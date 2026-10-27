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
// Bad PEM material is a catchable Error with Node's OpenSSL message and code.
const show = (label, fn) => {
  try { fn(); console.log(label, 'ok'); } catch (e) { console.log(label, e.name, e.code, e.message); }
};
show('cert garbage', () => tls.createSecureContext({ cert: 'garbage', key: KEY }));
show('cert with bogus body', () => tls.createSecureContext({ cert: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n', key: KEY }));
show('key garbage', () => tls.createSecureContext({ cert: CERT, key: 'garbage' }));
show('key with bogus body', () => tls.createSecureContext({ cert: CERT, key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n' }));
show('valid pair after failures', () => tls.createSecureContext({ cert: CERT, key: KEY }));
