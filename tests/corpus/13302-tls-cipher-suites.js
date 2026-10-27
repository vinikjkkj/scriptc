import tls from 'tls';
// A list whose TLS_ entries are TLS1.3 suites: they go to set_ciphersuites
// (their own verdict), the rest to the TLS<=1.2 list; both empty is the
// ERR_INVALID_ARG_VALUE of the parts.
const show = (label, ciphers) => {
  try { tls.createSecureContext({ ciphers }); console.log(label, 'ok'); }
  catch (e) { console.log(label, e.name, e.code, e.message); }
};
const cases = [
  'TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_CCM_SHA256', 'TLS_AES_128_CCM_8_SHA256', 'TLS_BOGUS', '!TLS_BOGUS',
  '!TLS_AES_128_GCM_SHA256', 'TLS_AES_128_GCM_SHA256:TLS_BOGUS', 'TLS_AES_128_GCM_SHA256:x',
  'x:TLS_AES_128_GCM_SHA256', 'TLS_AES_128_GCM_SHA256:!TLS_AES_128_GCM_SHA256',
  'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:!TLS_AES_128_GCM_SHA256',
  '!TLS_AES_128_GCM_SHA256:!TLS_AES_256_GCM_SHA384:!TLS_CHACHA20_POLY1305_SHA256:!TLS_AES_128_CCM_SHA256:!TLS_AES_128_CCM_8_SHA256',
  'TLS_AES_128_GCM_SHA256:ECDHE-RSA-AES128-GCM-SHA256', 'TLS_BOGUS:ECDHE-RSA-AES128-GCM-SHA256',
  'TLS_AES_128_GCM_SHA256:TLS_AES_128_GCM_SHA256:x', 'ECDHE-RSA-AES128-GCM-SHA256:TLS_BOGUS',
  'TLS_AES_128_GCM_SHA256@BOGUS', 'TLS_AES_128_GCM_SHA256 ECDHE', ':TLS_AES_128_GCM_SHA256:',
  ':', '::', ':::', ': :',
];
for (const c of cases) show(JSON.stringify(c), c);
