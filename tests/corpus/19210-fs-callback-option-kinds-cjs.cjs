// Corpus 19210: option kinds through variables for fs.mkdir (its options are not signal-
// fenced): a boolean where recursive is typed, and an invalid mode string; the callback
// forms with literal options. Works in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19210';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const tryit = (tag, f) => { try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); } };
const BAD_REC = { recursive: 'yes' };
const BAD_MODE = { mode: 'zz' };
tryit('rec-string', () => fs.mkdir(D + '/r1', BAD_REC, () => {}));
tryit('mode-string', () => fs.mkdir(D + '/r2', BAD_MODE, () => {}));
fs.mkdir(D + '/r3', { recursive: true }, (e, first) => {
  console.log('rec-literal', e, first === undefined ? 'none' : 'made');
  fs.mkdir(D + '/r3', { recursive: false, mode: 0o750 }, (e2) => {
    console.log('plain-exists', e2 && e2.code, e2 && e2.syscall);
    fs.rmSync(D, { recursive: true, force: true });
    console.log('main end');
  });
});
console.log('main end');
