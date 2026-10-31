// Corpus 19600: fs.open, fs.close and fs.chmod callback forms, chained one
// loop turn at a time in a private mkdtemp directory. No path, errno number
// or OS text is printed; filesystem errors print code and syscall only.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19600-');
const F = D + '/a.txt';
const jobs = [];
const step = (tag, f) => jobs.push((next) => {
  try { f(next); } catch (e) { console.log(tag, 'THROW', e.name, e.code); next(); }
});
let fd = -1;
step('open-w', (next) => fs.open(F, 'w', 0o644, (e, n) => {
  console.log('open-w', e === null, typeof n, n >= 0);
  fd = n;
  next();
}));
step('write-buf-off', (next) => fs.write(fd, Buffer.from('ABCDEFGH'), 2, 4, null, (e, n, b) => {
  console.log('write-buf-off', e === null, n, b.toString());
  next();
}));
step('write-str-pos', (next) => fs.write(fd, 'xyz', 6, 'utf8', (e, n, s) => {
  console.log('write-str-pos', e === null, n, s);
  next();
}));
step('write-str-cur', (next) => fs.write(fd, 'Q', (e, n, s) => {
  console.log('write-str-cur', e === null, n, s);
  next();
}));
step('close-cb', (next) => fs.close(fd, (e, ...rest) => {
  console.log('close-cb', e === null, rest.length);
  next();
}));
step('read-back', (next) => {
  console.log('read-back', JSON.stringify(fs.readFileSync(F, 'utf8')));
  next();
});
step('open-cb-only', (next) => fs.open(F, (e, n) => {
  console.log('open-cb-only', e === null, typeof n);
  fs.closeSync(n);
  next();
}));
step('chmod-ok', (next) => fs.chmod(F, 0o600, (e) => {
  console.log('chmod-ok', e === null);
  next();
}));
step('chmod-str', (next) => fs.chmod(F, '644', (e) => {
  console.log('chmod-str', e === null);
  next();
}));
step('chmod-missing', (next) => fs.chmod(D + '/missing', 0o600, (e) => {
  console.log('chmod-missing', e.code, e.syscall);
  next();
}));
step('close-bad', (next) => fs.close(987654, (e) => {
  console.log('close-bad', e.code, e.syscall);
  next();
}));
step('open-missing', (next) => fs.open(D + '/no/such', 'r', (e, n) => {
  console.log('open-missing', e.code, e.syscall, n);
  next();
}));
const run = () => {
  const j = jobs.shift();
  if (!j) { fs.rmSync(D, { recursive: true, force: true }); console.log('main end'); return; }
  j(run);
};
run();
