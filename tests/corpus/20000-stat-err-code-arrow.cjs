// Corpus 20000: fs.stat callback reads err.code unguarded (error path), arrow form. No path printed.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20000-');
fs.stat(D + '/missing', (err, s) => { console.log(err.code); fs.rmSync(D, { recursive: true, force: true }); });
