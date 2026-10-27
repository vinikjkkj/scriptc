import tls from 'tls';
// createSecureContext's ciphers string is Node's processCiphers plus the
// OpenSSL cipher-list verdict: a list that selects nothing is Node's
// ERR_SSL_NO_CIPHER_MATCH, a valid list builds (the context is a handle, so
// only the verdict is printed here).
const show = (label, opts) => {
  try { tls.createSecureContext(opts); console.log(label, 'ok'); }
  catch (e) { console.log(label, e.name, e.code, e.message); }
};
const lists = [
  'AES256-SHA', 'ECDHE-RSA-AES128-GCM-SHA256', 'HIGH:!aNULL', 'DEFAULT', 'DEFAULT:!DEFAULT',
  'ALL:!ALL', '!ALL', 'NULL:!NULL', 'eNULL', 'aNULL', 'ADH', 'SSLv3', 'TLSv1.2', 'TLSv1',
  'TLSv1.3', 'kRSA', 'ECDHE+AESGCM', 'kECDHE:-ECDHE-RSA-AES128-SHA', 'MEDIUM', 'LOW',
  'RC4', '3DES', 'DES', 'IDEA', 'SEED', 'CAMELLIA256-SHA', 'PSK', 'SRP', 'ARIA', 'CHACHA20',
  'kPSK', 'AECDH', 'x', 'x:y', 'AES256-SHA:x', 'a b', ' ', 'ECDHE,AESGCM', 'ECDHE;kRSA',
  'COMPLEMENTOFALL', 'COMPLEMENTOFDEFAULT', 'DEFAULT@SECLEVEL=0', 'HIGH@STRENGTH',
  'ALL@SECLEVEL=1', 'NULL-SHA', 'EXP40', 'FIPS', 'SUITEB128', 'SUITEB192', 'SUITEB128ONLY',
  'kDH', 'DH', 'EECDH', 'EDH', 'DHE-RSA-AES256-SHA256', 'ECDSA', 'aRSA', 'aECDSA',
];
for (const c of lists) show(JSON.stringify(c), { ciphers: c });
show('empty string', { ciphers: '' });
show('undefined', { ciphers: undefined });
show('null', { ciphers: null });
show('only separators', { ciphers: ':' });
show('two separators', { ciphers: '::' });
show('NUL truncates', { ciphers: 'ECDHE\u0000x' });
