// Corpus 20019: a ternary over the stat error, then a second stat whose error code is read unguarded in a nested callback.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20019-');
fs.stat(D + '/a', (err, s) => {
  console.log(err ? err.code : 'no-error');
  fs.stat(D + '/b', (err2) => {
    console.log(err2.code, err2.syscall);
    fs.rmSync(D, { recursive: true, force: true });
  });
});
