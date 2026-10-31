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
let curTag = '';
let curNext = () => {};
const CB = (e, ...r) => {
  console.log(curTag, 'CB', e === null ? 'null' : e.code + ' ' + e.syscall, r.length, typeof r[0]);
  curNext();
};
// Every successful open closes its descriptor before the directory is removed:
// Windows refuses to delete a directory that still holds an open file.
const CBO = (e, ...r) => {
  console.log(curTag, 'CB', e === null ? 'null' : e.code + ' ' + e.syscall, r.length, typeof r[0]);
  if (e === null) fs.closeSync(r[0]);
  curNext();
};
const asy = (tag, f) => jobs.push((next) => {
  curTag = tag;
  curNext = next;
  try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); next(); }
});
sync('path-number', () => fs.open(5, 'r', () => {}));
sync('flags-bad', () => fs.open(F, 'zz', () => {}));
sync('flags-no-cb', () => fs.open(F, 'r'));
sync('mode-bad', () => fs.open(F, 'r', 'bad', () => {}));
sync('mode-bool-cb-missing', () => fs.open(F, 'r', 0o600));
sync('cb-null', () => fs.open(F, 'r', null));
sync('cb-number', () => fs.open(F, 'r', 0o600, 7));
asy('read-open', () => fs.open(F, 'r', CBO));
asy('cb-only-open', () => fs.open(F, CBO));
asy('undefined-flags', () => fs.open(F, undefined, CBO));
asy('null-mode', () => fs.open(F, 'r', null, CBO));
asy('string-mode', () => fs.open(F, 'r', '600', CBO));
asy('missing-dir', () => fs.open(D + '/no/such', 'r', CBO));
asy('numeric-flags', () => fs.open(F, 0, CBO));
const run = () => {
  const j = jobs.shift();
  if (!j) { fs.rmSync(D, { recursive: true, force: true }); console.log('main end'); return; }
  j(run);
};
run();
