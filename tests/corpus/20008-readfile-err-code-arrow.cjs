// Corpus 20008: readFile error member read (already dynamic on main); pins that the stat fix did not change it.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20008-');
fs.readFile(D + '/missing', 'utf8', (err, data) => { console.log(err.code, err.syscall, data === undefined); fs.rmSync(D, { recursive: true, force: true }); });
