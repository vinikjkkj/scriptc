// Corpus 19601: fs.write callback forms (buffer with offset, length and
// position, options object, the two-argument form, string with position and
// encoding, and a string at the current position), chained in a private
// mkdtemp directory. Each step prints the callback's arguments and the file.
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19601-');
const F = D + '/w.txt';
const jobs = [];
const step = (tag, f) => jobs.push((next) => {
  try { f(next); } catch (e) { console.log(tag, 'THROW', e.name, e.code); next(); }
});
const show = () => JSON.stringify(fs.readFileSync(F).toString('hex'));
const fd = fs.openSync(F, 'w+');
const buf = Buffer.from('ABCDEFGH');
step('buf-opts', (next) => fs.write(fd, buf, { offset: 1, length: 2, position: 0 }, (e, n, b) => {
  console.log('buf-opts', e === null, n, b.toString(), show()); next();
}));
step('buf-current', (next) => fs.write(fd, buf, (e, n) => {
  console.log('buf-current', e === null, n, show()); next();
}));
step('buf-offset-cb-in-position', (next) => fs.write(fd, buf, 1, 2, (e, n) => {
  console.log('buf-offset-cb-in-position', e === null, n, show()); next();
}));
step('buf-undef-pos', (next) => fs.write(fd, buf, undefined, undefined, 1, (e, n) => {
  console.log('buf-undef-pos', e === null, n, show()); next();
}));
step('buf-null-opts', (next) => fs.write(fd, buf, null, null, null, (e, n) => {
  console.log('buf-null-opts', e === null, n); next();
}));
step('buf-empty', (next) => fs.write(fd, Buffer.alloc(0), 0, 0, 0, (e, n, b) => {
  console.log('buf-empty', e === null, n, b.length); next();
}));
step('str-cb-only', (next) => fs.write(fd, 'Q1', (e, n, s) => {
  console.log('str-cb-only', e === null, n, s, show()); next();
}));
step('str-pos', (next) => fs.write(fd, 'Q2', 3, (e, n) => {
  console.log('str-pos', e === null, n, show()); next();
}));
step('str-pos-enc', (next) => fs.write(fd, 'Q3', 4, 'utf8', (e, n) => {
  console.log('str-pos-enc', e === null, n, show()); next();
}));
step('str-latin1', (next) => fs.write(fd, 'é', 9, 'latin1', (e, n) => {
  console.log('str-latin1', e === null, n, show()); next();
}));
step('str-hex-bad', (next) => fs.write(fd, 'zz', 0, 'hex', (e, n, s) => {
  console.log('str-hex-bad', e === null, n, s); next();
}));
step('str-unknown-enc', (next) => fs.write(fd, 'abc', 0, 'nope', (e, n) => {
  console.log('str-unknown-enc', e === null, n, show()); next();
}));
step('str-null-pos', (next) => fs.write(fd, 'Q5', null, (e, n) => {
  console.log('str-null-pos', e === null, n, show()); next();
}));
step('str-float-pos', (next) => fs.write(fd, 'Q6', 6.5, (e, n) => {
  console.log('str-float-pos', e === null, n, show()); next();
}));
step('buf-after-close', (next) => { fs.closeSync(fd); fs.write(fd, 'late', (e, n) => {
  console.log('buf-after-close', e.code, e.syscall, n); next(); }); });
const run = () => {
  const j = jobs.shift();
  if (!j) { fs.rmSync(D, { recursive: true, force: true }); console.log('main end'); return; }
  j(run);
};
run();
