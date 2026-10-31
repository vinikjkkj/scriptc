// Corpus 19206: fs callback form of m1 (rows 19206); operates in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19206';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const show = (tag, ...a) => console.log(tag, a.length, a.map((x) => (x === undefined ? 'undef' : x === null ? 'null' : typeof x)).join(','), a[1] === undefined ? '' : JSON.stringify(a[1]));
fs.mkdir(D + '/md-plain', (...a) => {
  show('plain', ...a);
  fs.mkdir(D + '/md-plain', (eb) => {
    console.log('eexist', eb.code, eb.errno, eb.syscall, eb.path, eb.message, Object.keys(eb).sort().join(','));
    fs.mkdir(D + '/md-mode', 0o700, (...c) => {
      show('mode', ...c);
      fs.mkdir(D + '/md-rec/a/b', { recursive: true }, (...d) => {
        show('rec-created', ...d);
        fs.mkdir(D + '/md-rec/a/b', { recursive: true }, (...e) => {
          show('rec-existing', ...e);
          fs.mkdir(D + '/md-rec/a/b/c', { recursive: true, mode: 0o750 }, (...f) => {
            show('rec-mode', ...f);
            fs.writeFileSync(D + '/md-file', 'x');
            fs.mkdir(D + '/md-file/sub', { recursive: true }, (eg) => {
              console.log('rec-enotdir', eg.code, eg.errno, eg.syscall, eg.path, eg.message);
              fs.mkdir(D + '/md-nope/x/y', (eh) => {
                console.log('plain-enoent', eh.code, eh.errno, eh.syscall, eh.path, eh.message);
                fs.mkdir(D + '/md-null', null, (...i) => {
                  show('null-opts', ...i);
                  fs.mkdir(D + '/md-nullrec', { recursive: false }, (...j) => {
                    show('recfalse', ...j);
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
  });
});
console.log('main end');
