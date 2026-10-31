// Corpus 19204: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19204-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

fs.appendFile(D + '/a.txt', 'one', (e) => {
  cb('plain')(e); console.log('text', fs.readFileSync(D + '/a.txt', 'utf8'));
  fs.appendFile(D + '/a.txt', Buffer.from('-two'), (e2) => {
    cb('buf')(e2); console.log('text', fs.readFileSync(D + '/a.txt', 'utf8'));
    fs.appendFile(D + '/a.txt', '-3', { encoding: 'utf8', mode: 0o600 }, (e3) => {
      cb('opts')(e3); console.log('text', fs.readFileSync(D + '/a.txt', 'utf8'));
      fs.appendFile(D + '/a.txt', '4', 'utf8', (e4) => {
        cb('enc-str')(e4); console.log('text', fs.readFileSync(D + '/a.txt', 'utf8'));
        fs.appendFile(D + '/a.txt', '-w', { flag: 'w' }, (e5) => {
          cb('flag-w')(e5); console.log('text', fs.readFileSync(D + '/a.txt', 'utf8'));
          fs.appendFile(D + '/missing/x', 'q', (e6) => {
            console.log('enoent', e6.code, e6.syscall);
            fs.rmSync(D, { recursive: true, force: true });
            console.log('main end');
          });
        });
      });
    });
  });
});

