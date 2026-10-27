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
// An encrypted key needs its passphrase: missing or wrong gives Node's
// ERR_OSSL_BAD_DECRYPT, the right one builds; a plain key ignores it.
const show = (label, fn) => {
  try { fn(); console.log(label, 'ok'); } catch (e) { console.log(label, e.name, e.code, e.message); }
};
show('legacy encrypted, no passphrase', () => tls.createSecureContext({ cert: CERT, key: `-----BEGIN EC PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-256-CBC,70615DD3A47D56D47432CBB3B80A7B13

TsF45Xgj7Qyg4jGpYpIFllJCXU6TwK8sm/FvBrsM2CiOOfAcVnsH2BKzsxxb4Glv
VXGiYIzrGndCzoWuED9h4alWNtIkP5Xwr52pTwdYZJfA6R7pha1N7/zerpRpDC3Q
siZwrqSQlzI5A8ZKYrO3k9nJlX8fck9O/6md3zE9WEM=
-----END EC PRIVATE KEY-----` }));
show('legacy encrypted, right passphrase', () => tls.createSecureContext({ cert: CERT, key: `-----BEGIN EC PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-256-CBC,70615DD3A47D56D47432CBB3B80A7B13

TsF45Xgj7Qyg4jGpYpIFllJCXU6TwK8sm/FvBrsM2CiOOfAcVnsH2BKzsxxb4Glv
VXGiYIzrGndCzoWuED9h4alWNtIkP5Xwr52pTwdYZJfA6R7pha1N7/zerpRpDC3Q
siZwrqSQlzI5A8ZKYrO3k9nJlX8fck9O/6md3zE9WEM=
-----END EC PRIVATE KEY-----`, passphrase: 'secret123' }));
show('legacy encrypted, wrong passphrase', () => tls.createSecureContext({ cert: CERT, key: `-----BEGIN EC PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-256-CBC,70615DD3A47D56D47432CBB3B80A7B13

TsF45Xgj7Qyg4jGpYpIFllJCXU6TwK8sm/FvBrsM2CiOOfAcVnsH2BKzsxxb4Glv
VXGiYIzrGndCzoWuED9h4alWNtIkP5Xwr52pTwdYZJfA6R7pha1N7/zerpRpDC3Q
siZwrqSQlzI5A8ZKYrO3k9nJlX8fck9O/6md3zE9WEM=
-----END EC PRIVATE KEY-----`, passphrase: 'nope' }));
show('pkcs8 encrypted, right passphrase', () => tls.createSecureContext({ cert: CERT, key: `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIH0MF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBA/7eM8YbfXMzvdV6IZ
VbZaAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQs5HMromk+F50l8o+
Yr7iuQSBkP3U5ylgtIXH7uMBLXT13NvBPW2Ps0gY/ZRhosYkl+3nWFumXqb6IX7F
Vw23JnVv+aNU+EZS2xP1SOHE4ltfbg4tHmNstvc4sNpJRkRKv5uj7y39BtoDuPdc
rl9szvPPGTpIc6DeSRpH/Jkf9eCqFE+5HaRcGGwmurQgPgEugn2mXhtTlMOCE5Wh
5SuKbX9b4w==
-----END ENCRYPTED PRIVATE KEY-----`, passphrase: 'secret123' }));
show('pkcs8 encrypted, no passphrase', () => tls.createSecureContext({ cert: CERT, key: `-----BEGIN ENCRYPTED PRIVATE KEY-----
MIH0MF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBA/7eM8YbfXMzvdV6IZ
VbZaAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQs5HMromk+F50l8o+
Yr7iuQSBkP3U5ylgtIXH7uMBLXT13NvBPW2Ps0gY/ZRhosYkl+3nWFumXqb6IX7F
Vw23JnVv+aNU+EZS2xP1SOHE4ltfbg4tHmNstvc4sNpJRkRKv5uj7y39BtoDuPdc
rl9szvPPGTpIc6DeSRpH/Jkf9eCqFE+5HaRcGGwmurQgPgEugn2mXhtTlMOCE5Wh
5SuKbX9b4w==
-----END ENCRYPTED PRIVATE KEY-----` }));
show('plain key, passphrase ignored', () => tls.createSecureContext({ cert: CERT, key: KEY, passphrase: 'whatever' }));
