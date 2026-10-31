// Corpus 19204: fs callback form of a1 (rows 19204); operates in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19204';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.appendFile(D + '/ap-a.txt', 'one', (e) => {
  console.log('plain', e, fs.readFileSync(D + '/ap-a.txt', 'utf8'));
  fs.appendFile(D + '/ap-a.txt', Buffer.from('-two'), (e2) => {
    console.log('buf', e2, fs.readFileSync(D + '/ap-a.txt', 'utf8'));
    fs.appendFile(D + '/ap-a.txt', '-3', { encoding: 'utf8', mode: 0o600 }, (e3) => {
      console.log('opts', e3, fs.readFileSync(D + '/ap-a.txt', 'utf8'));
      fs.appendFile(D + '/ap-a.txt', '4', 'utf8', (e4) => {
        console.log('enc-str', e4, fs.readFileSync(D + '/ap-a.txt', 'utf8'));
        fs.appendFile(D + '/ap-a.txt', '-w', { flag: 'w' }, (e5) => {
          console.log('flag-w', e5, fs.readFileSync(D + '/ap-a.txt', 'utf8'));
          fs.appendFile(D + '/ap-missing/x', 'q', (e6) => {
            console.log('enoent', e6.code, e6.errno, e6.syscall, e6.path, e6.message);
            console.log('main end');
            fs.rmSync(D, { recursive: true, force: true });
          });
        });
      });
    });
  });
});
console.log('main end');
