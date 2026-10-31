// Corpus 19208: fs callback form of u1 (rows 19208); operates in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19208';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const show = (tag, ...a) => console.log(tag, a.length, a.map((x) => (x === undefined ? 'undef' : x === null ? 'null' : typeof x)).join(','));
fs.writeFileSync(D + '/ur-a', 'x');
fs.unlink(D + '/ur-a', (...a) => {
  show('unlink-ok', ...a);
  fs.unlink(D + '/ur-a', (e) => {
    console.log('unlink-enoent', e.code, e.errno, e.syscall, e.path, e.message, Object.keys(e).sort().join(','));
    fs.writeFileSync(D + '/ur-b', 'y');
    fs.rename(D + '/ur-b', D + '/ur-c', (...b) => {
      show('rename-ok', ...b);
      console.log('renamed', fs.existsSync(D + '/ur-b'), fs.readFileSync(D + '/ur-c', 'utf8'));
      fs.rename(D + '/ur-missing', D + '/ur-d', (e2) => {
        console.log('rename-enoent', e2.code, e2.errno, e2.syscall, e2.path, e2.dest, e2.message, Object.keys(e2).sort().join(','));
        fs.mkdirSync(D + '/ur-dir');
        fs.rename(D + '/ur-c', D + '/ur-dir', (e3) => {
          console.log('rename-eisdir', e3.code, e3.errno, e3.syscall, e3.path, e3.dest, e3.message);
          fs.unlink(D + '/ur-dir', (e4) => {
            console.log('unlink-dir', e4.code, e4.errno, e4.syscall, e4.path, e4.message);
            fs.rmdirSync(D + '/ur-dir'); fs.unlinkSync(D + '/ur-c');
            console.log('main end');
            fs.rmSync(D, { recursive: true, force: true });
          });
        });
      });
    });
  });
});
console.log('main end');
