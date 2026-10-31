// Corpus 20002: fs.stat error members errno, syscall and code read unguarded; the path is compared, not printed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20002-');
const target = path.join(D, 'missing');
fs.stat(target, (err, s) => {
  console.log(err.errno, err.syscall, err.code, err.path === target);
  fs.rmSync(D, { recursive: true, force: true });
});
