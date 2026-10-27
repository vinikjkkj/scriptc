import tls from 'tls';
// The @-directives and the operators of an OpenSSL cipher list: a malformed
// directive on a KNOWN name is ERR_SSL_INVALID_COMMAND, on an unknown name the
// token is skipped, and a directive that leaves nothing selected is
// ERR_SSL_NO_CIPHER_MATCH.
const show = (label, ciphers) => {
  try { tls.createSecureContext({ ciphers }); console.log(label, 'ok'); }
  catch (e) { console.log(label, e.name, e.code, e.message); }
};
const cases = [
  'ECDHE@BOGUS', 'ECDHE@', '@', '@STRENGTH', '@STRENGTHX', '@STRENGTH x', 'ECDHE@STRENGTH',
  'ECDHE@STRENGTH@BOGUS', 'ECDHE@SECLEVEL=', 'ECDHE@SECLEVEL=x', 'ECDHE@SECLEVEL=1x',
  'ECDHE@SECLEVEL=-1', 'ECDHE@SECLEVEL=0', 'ECDHE@SECLEVEL=5', 'ECDHE@SECLEVEL=6',
  'ECDHE@SECLEVEL=99999999999', 'ECDHE@SECLEVEL=1 ECDHE', 'ECDHE@SECLEVEL=1@STRENGTH',
  '@SECLEVEL=1@SECLEVEL=x', 'x@BOGUS', '!x@BOGUS', 'x DEFAULT@BOGUS', 'DEFAULT@BOGUS',
  'DEFAULT@STRENGTH', 'DEFAULT@SECLEVEL=9', '!ECDHE@BOGUS', '-ECDHE@BOGUS', '+ECDHE@BOGUS',
  'ECDHE+', '!', '-', '+', 'ECDHE!', '!!ECDHE', 'ECDHE!!', 'ECDHE:!', 'ECDHE\u0001',
  '\u0001ECDHE', 'ECDHE/x', 'ECDHE_x', 'ECDHE.x', 'ECDHE=x', 'x=y', 'ECDHE x\u000f',
  'ECDHE!ECDHE', 'ALL!ECDHE', '!ALL:ECDHE', 'ALL:-ALL:ECDHE', '-ALL:ECDHE', 'x:-ECDHE:kRSA',
  'ECDHE+ALL', 'ECDHE+AESGCM@t', 'ECDHE-AES256-CCM@t',
];
for (const c of cases) show(JSON.stringify(c), c);
