// Corpus 19211: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19211-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

fs.writeFile(D + '/a.txt', 'alpha', (e1) => {
  cb('plain')(e1);
  fs.writeFile(D + '/b.txt', 'beta', 'utf8', (e2) => {
    cb('enc')(e2);
    fs.writeFile(D + '/c.txt', 'gamma', { flag: 'w', mode: 0o600, flush: true, encoding: 'utf8' }, (e3) => {
      cb('literal')(e3);
      fs.appendFile(D + '/c.txt', '-more', { flag: 'a' }, (e4) => {
        cb('append')(e4);
        console.log('read', fs.readFileSync(D + '/c.txt', 'utf8'), fs.readFileSync(D + '/a.txt', 'utf8'), fs.readFileSync(D + '/b.txt', 'utf8'));
        fs.rmSync(D, { recursive: true, force: true });
        console.log('main end');
      });
    });
  });
});

