import tls from 'tls';
// Node renders the split parts of an all-separator cipher string with util.inspect:
// one line up to six parts, then the grouped layout (100 shown, then "... more").
const show = (n) => {
  try { tls.createSecureContext({ ciphers: ':'.repeat(n - 1) }); console.log(n, 'ok'); }
  catch (e) { console.log(n, e.name, e.code, e.message); }
};
for (const n of [2, 3, 6, 7, 8, 12, 13, 26, 27, 40, 100, 101, 102, 150]) show(n);
