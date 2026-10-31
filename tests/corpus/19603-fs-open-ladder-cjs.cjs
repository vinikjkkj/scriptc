// Corpus 19603: argument ladder of the fs.open callback form, plus its
// file-level results. Sync throws print name, code and message; async errors
// print code and syscall. Private mkdtemp directory; no path is printed.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19603-');
const F = D + '/o.txt';
fs.writeFileSync(F, 'hello');
const jobs = [];
const sync = (tag, f) => jobs.push((next) => {
  try { f(); console.log(tag, 'NOTHROW'); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); }
  next();
});
const asy = (tag, f) => jobs.push((next) => {
  try {
    f((e, fd) => {
      console.log(tag, 'CB', e === null ? 'null' : e.code + ' ' + e.syscall, typeof fd);
      if (typeof fd === 'number' && e === null) fs.closeSync(fd);
      next();
    });
  } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); next(); }
});
sync('path-number', () => fs.open(5, 'r', () => {}));
sync('flags-bad', () => fs.open(F, 'zz', () => {}));
sync('flags-object', () => fs.open(F, {}, () => {}));
sync('flags-array', () => fs.open(F, [], () => {}));
sync('flags-no-cb', () => fs.open(F, 'r'));
sync('mode-bad', () => fs.open(F, 'r', 'bad', () => {}));
sync('mode-bool-cb-missing', () => fs.open(F, 'r', 0o600));
sync('cb-null', () => fs.open(F, 'r', null));
sync('cb-number', () => fs.open(F, 'r', 0o600, 7));
asy('read-open', (cb) => fs.open(F, 'r', cb));
asy('cb-only-open', (cb) => fs.open(F, cb));
asy('undefined-flags', (cb) => fs.open(F, undefined, cb));
asy('null-mode', (cb) => fs.open(F, 'r', null, cb));
asy('string-mode', (cb) => fs.open(F, 'r', '600', cb));
asy('missing-dir', (cb) => fs.open(D + '/no/such', 'r', cb));
asy('numeric-flags', (cb) => fs.open(F, 0, cb));
const run = () => {
  const j = jobs.shift();
  if (!j) { fs.rmSync(D, { recursive: true, force: true }); console.log('main end'); return; }
  j(run);
};
run();
