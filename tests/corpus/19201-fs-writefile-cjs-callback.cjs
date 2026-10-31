// Corpus 19201: fs callback form of w1 (rows 19201); operates in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19201';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
fs.writeFile(D + '/wf-a.txt', 'hello', (e) => {
  console.log('str', e, fs.readFileSync(D + '/wf-a.txt', 'utf8'));
  fs.writeFile(D + '/wf-b.bin', Buffer.from([0, 1, 255]), (e2) => {
    console.log('buf', e2, fs.readFileSync(D + '/wf-b.bin').toString('hex'));
    fs.writeFile(D + '/wf-c.bin', new Uint8Array([65, 66]), (e3) => {
      console.log('u8', e3, fs.readFileSync(D + '/wf-c.bin').toString('hex'));
      fs.writeFile(D + '/wf-d.txt', 'héllo', 'latin1', (e4) => {
        console.log('enc', e4, fs.readFileSync(D + '/wf-d.txt').length);
        fs.writeFile(D + '/wf-e.txt', 'opts', { encoding: 'utf8', mode: 0o600, flag: 'w' }, (e5) => {
          console.log('opts', e5, fs.readFileSync(D + '/wf-e.txt').length);
          fs.writeFile(D + '/wf-e.txt', 'more', { flag: 'a' }, (e6) => {
            console.log('append-flag', e6, fs.readFileSync(D + '/wf-e.txt', 'utf8'));
            fs.writeFile(D + '/wf-missing-dir/x.txt', 'a', (e7) => {
              console.log('enoent', e7.code, e7.errno, e7.syscall, e7.path, e7.message, Object.keys(e7).sort().join(','));
              fs.writeFile(D + '/wf-a.txt', 'again', { flag: 'wx' }, (e8) => {
                console.log('eexist', e8.code, e8.errno, e8.syscall, e8.path, e8.message);
                console.log('main end');
                fs.rmSync(D, { recursive: true, force: true });
              });
            });
          });
        });
      });
    });
  });
});
console.log('main end');
