// Corpus 20001: fs.stat callback reads err.message unguarded, function-expression form (error path).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20001-');
fs.stat(D + '/missing', function (err, s) {
  console.log(err.message.indexOf('ENOENT: no such file or directory, stat') === 0);
  fs.rmSync(D, { recursive: true, force: true });
});
