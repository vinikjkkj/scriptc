// Corpus 20004: the guarded forms of the stat callback, one error and one success.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20004-');
fs.stat(D + '/missing', (err, s) => {
  if (err) console.log('err', err.code); else console.log('ok', s.size);
  fs.stat(D, (err2, s2) => {
    if (err2) console.log('err2', err2.code); else console.log('ok2', s2.isDirectory());
    fs.rmSync(D, { recursive: true, force: true });
  });
});
