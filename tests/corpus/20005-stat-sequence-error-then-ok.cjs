// Corpus 20005: a stat error and a stat success in sequence, each reading its own member.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20005-');
fs.stat(D + '/nope', (e1, s1) => {
  console.log('first', e1.code, e1.errno);
  fs.stat(D, (e2, s2) => {
    try { console.log('second', e2.code); } catch (e) { console.log('second caught', e.message); }
    console.log('second dir', s2.isDirectory());
    fs.rmSync(D, { recursive: true, force: true });
  });
});
