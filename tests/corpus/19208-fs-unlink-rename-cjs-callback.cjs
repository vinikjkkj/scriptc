// Corpus 19208: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19208-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

fs.writeFileSync(D + '/ur-a', 'x');
fs.unlink(D + '/ur-a', (e) => {
  cb('unlink-ok')(e);
  fs.unlink(D + '/ur-a', (e2) => {
    console.log('unlink-enoent', e2.code, e2.syscall);
    fs.writeFileSync(D + '/ur-b', 'y');
    fs.rename(D + '/ur-b', D + '/ur-c', (e3) => {
      cb('rename-ok')(e3);
      console.log('renamed', fs.existsSync(D + '/ur-b'), fs.readFileSync(D + '/ur-c', 'utf8'));
      fs.rename(D + '/ur-missing', D + '/ur-d', (e4) => {
        console.log('rename-enoent', e4.code, e4.syscall);
        fs.rmSync(D, { recursive: true, force: true });
        console.log('main end');
      });
    });
  });
});

