// Corpus 20006: mkdir success delivers err null; err.code unguarded throws Node's TypeError, caught.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20006-');
fs.mkdir(D + '/sub', (err) => {
  try { console.log('code', err.code); } catch (e) { console.log('caught', e.name, e.message); }
  fs.mkdir(D + '/sub', (err2) => { console.log('again', err2.code, err2.syscall); fs.rmSync(D, { recursive: true, force: true }); });
});
