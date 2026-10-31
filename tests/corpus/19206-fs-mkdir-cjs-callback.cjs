// Corpus 19206: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19206-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

fs.mkdir(D + '/md-plain', (e) => {
  cb('plain')(e);
  fs.mkdir(D + '/md-plain', (e2) => {
    console.log('eexist', e2.code, e2.syscall);
    fs.mkdir(D + '/md-mode', 0o700, (e3) => {
      cb('mode')(e3);
      fs.mkdir(D + '/md-rec/a/b', { recursive: true }, (e4, first) => {
        cb('rec-created')(e4);
        console.log('first', typeof first === 'string' && first.endsWith('md-rec'));
        fs.mkdir(D + '/md-rec/a/b', { recursive: true }, (e5, again) => {
          console.log('rec-existing', e5 === null ? 'null' : e5.code, again === undefined ? 'no-path' : 'path');
          fs.mkdir(D + '/md-rec/a/b/c', { recursive: true, mode: 0o750 }, (e6, deep) => {
            console.log('rec-mode', e6, typeof deep === 'string' && deep.endsWith('c'));
            fs.writeFileSync(D + '/md-file', 'x');
            fs.mkdir(D + '/md-file/sub', { recursive: true }, (e7) => {
              console.log('rec-enotdir', e7.code, e7.syscall);
              fs.mkdir(D + '/md-nope/x/y', (e8) => {
                console.log('plain-enoent', e8.code, e8.syscall);
                fs.mkdir(D + '/md-null', null, (e9) => {
                  cb('null-opts')(e9);
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
});

