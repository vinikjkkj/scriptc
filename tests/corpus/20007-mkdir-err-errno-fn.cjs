// Corpus 20007: mkdir over an existing directory; errno and code read unguarded in a function expression.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20007-');
fs.mkdir(D, function (err) { console.log(err.errno, err.code); fs.rmSync(D, { recursive: true, force: true }); });
