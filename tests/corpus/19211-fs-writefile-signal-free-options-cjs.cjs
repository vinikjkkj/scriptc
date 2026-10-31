// fs.writeFile / fs.appendFile callbacks whose options are provably signal-free: no
// options (the callback in the options slot), the encoding string, and literal option
// objects (flag, mode, flush, encoding). Each step starts after the previous callback,
// so completion order is fixed. Works in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19211';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.writeFile(D + '/a.txt', 'alpha', (e1) => {
  console.log('plain', e1);
  fs.writeFile(D + '/b.txt', 'beta', 'utf8', (e2) => {
    console.log('enc', e2);
    fs.writeFile(D + '/c.txt', 'gamma', { flag: 'w', mode: 0o600, flush: true, encoding: 'utf8' }, (e3) => {
      console.log('literal', e3);
      fs.appendFile(D + '/c.txt', '-more', { flag: 'a' }, (e4) => {
        console.log('append', e4);
        console.log('read', fs.readFileSync(D + '/c.txt', 'utf8'), fs.readFileSync(D + '/a.txt', 'utf8'), fs.readFileSync(D + '/b.txt', 'utf8'));
        fs.rmSync(D, { recursive: true, force: true });
        console.log('main end');
      });
    });
  });
});
console.log('main end');
