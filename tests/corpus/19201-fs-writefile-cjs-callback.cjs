// Corpus 19201: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19201-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

fs.writeFile(D + '/a.txt', 'hello', (e) => {
  cb('str')(e); console.log('read', fs.readFileSync(D + '/a.txt', 'utf8'));
  fs.writeFile(D + '/b.bin', Buffer.from([0, 1, 255]), (e2) => {
    cb('buf')(e2); console.log('hex', fs.readFileSync(D + '/b.bin').toString('hex'));
    fs.writeFile(D + '/c.bin', new Uint8Array([65, 66]), (e3) => {
      cb('u8')(e3); console.log('hex', fs.readFileSync(D + '/c.bin').toString('hex'));
      fs.writeFile(D + '/d.txt', 'héllo', 'latin1', (e4) => {
        cb('enc')(e4); console.log('len', fs.readFileSync(D + '/d.txt').length);
        fs.writeFile(D + '/e.txt', 'opts', { encoding: 'utf8', mode: 0o600, flag: 'w' }, (e5) => {
          cb('opts')(e5);
          fs.writeFile(D + '/e.txt', 'more', { flag: 'a' }, (e6) => {
            cb('append-flag')(e6); console.log('text', fs.readFileSync(D + '/e.txt', 'utf8'));
            fs.writeFile(D + '/missing/x.txt', 'a', (e7) => {
              console.log('enoent', e7.code, e7.syscall);
              fs.writeFile(D + '/a.txt', 'again', { flag: 'wx' }, (e8) => {
                console.log('eexist', e8.code, e8.syscall);
                fs.rmSync(D, { recursive: true, force: true });
                console.log('main end');
              });
            });
          });
        });
      });
    });
  });
});

