// Corpus 19602: argument ladders of fs.write, fs.close and fs.chmod callback
// forms. Sync throws print name, code and message (no path, no errno); async
// filesystem errors print code and syscall. Private mkdtemp directory.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19602-');
const F = D + '/w.txt';
fs.writeFileSync(F, 'base');
const jobs = [];
const sync = (tag, f) => jobs.push((next) => {
  try { f(); console.log(tag, 'NOTHROW'); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); }
  next();
});
let curTag = '';
let curNext = () => {};
const CB = (e, ...r) => {
  console.log(curTag, 'CB', e === null ? 'null' : e.code + ' ' + e.syscall, r.length, r[0]);
  curNext();
};
const asy = (tag, f) => jobs.push((next) => {
  curTag = tag;
  curNext = next;
  try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); next(); }
});
const buf = Buffer.from('ABCDEFGH');
const fd = fs.openSync(F, 'r+');
sync('w-fd-string', () => fs.write('3', buf, () => {}));
sync('w-fd-float', () => fs.write(1.5, buf, () => {}));
sync('w-nocb', () => fs.write(fd, buf));
sync('w-cb-string', () => fs.write(fd, buf, 0, 2, 0, 'x'));
sync('w-cb-null', () => fs.write(fd, buf, 0, 2, 0, null));
sync('w-offset-big', () => fs.write(fd, buf, 99, () => {}));
sync('w-length-big', () => fs.write(fd, buf, 0, 999, () => {}));
sync('w-offset-neg', () => fs.write(fd, buf, -1, () => {}));
sync('w-offset-float', () => fs.write(fd, buf, 1.5, () => {}));
sync('w-length-neg', () => fs.write(fd, buf, 0, -1, 0, () => {}));
sync('w-length-nan', () => fs.write(fd, buf, 0, NaN, 0, () => {}));
sync('w-opts-offset-str', () => fs.write(fd, buf, { offset: '1' }, () => {}));
sync('s-number', () => fs.write(fd, 123, () => {}));
sync('s-bad-encoding-ok', () => fs.write(fd, 'abc', 0, 'nope', () => {}));
sync('s-hex-odd', () => fs.write(fd, 'abc', 0, 'hex', () => {}));
sync('s-cb-not-fn', () => fs.write(fd, 'x', 0, 'latin1', 5));
sync('close-cb-number', () => fs.close(fd, 5));
sync('close-fd-string', () => fs.close('3', () => {}));
sync('close-fd-float', () => fs.close(1.5, () => {}));
sync('close-fd-neg', () => fs.close(-1, () => {}));
sync('chmod-nomode', () => fs.chmod(F, undefined, () => {}));
sync('chmod-badmode', () => fs.chmod(F, 'zz', () => {}));
sync('chmod-negmode', () => fs.chmod(F, -1, () => {}));
sync('chmod-nocb', () => fs.chmod(F, 0o600));
sync('chmod-path-number', () => fs.chmod(7, 0o600, () => {}));
asy('w-ebadf', () => fs.write(987654, 'x', CB));
asy('w-buf-ebadf', () => fs.write(987654, buf, 0, 2, null, CB));
asy('close-ebadf', () => fs.close(987654, CB));
asy('chmod-enoent', () => fs.chmod(D + '/none', 0o600, CB));
asy('w-ok-after', () => fs.write(fd, buf, 0, 3, 0, CB));
asy('close-ok', () => fs.close(fd, CB));
const run = () => {
  const j = jobs.shift();
  if (!j) { fs.rmSync(D, { recursive: true, force: true }); console.log('main end'); return; }
  j(run);
};
run();
