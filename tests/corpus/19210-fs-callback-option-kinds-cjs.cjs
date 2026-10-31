// Corpus 19210: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19210-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

const tryit = (tag, f) => { try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); } };
const BAD_REC = { recursive: 'yes' };
const BAD_MODE = { mode: 'zz' };
tryit('rec-string', () => fs.mkdir(D + '/r1', BAD_REC, () => {}));
tryit('mode-string', () => fs.mkdir(D + '/r2', BAD_MODE, () => {}));
fs.mkdir(D + '/r3', { recursive: true }, (e, first) => {
  console.log('rec-literal', e === null ? 'null' : e.code, first === undefined ? 'none' : 'made');
  fs.mkdir(D + '/r3', { recursive: false, mode: 0o750 }, (e2) => {
    console.log('plain-exists', e2.code, e2.syscall);
    fs.rmSync(D, { recursive: true, force: true });
    console.log('main end');
  });
});

