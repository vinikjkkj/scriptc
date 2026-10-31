// Corpus 20003: fs.stat success delivers err null; an unguarded err.code throws Node's TypeError, caught.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20003-');
fs.stat(D, (err, s) => {
  try { console.log('code', err.code); } catch (e) { console.log('caught', e.name, e.message); }
  console.log('dir', s.isDirectory());
  fs.rmSync(D, { recursive: true, force: true });
});
