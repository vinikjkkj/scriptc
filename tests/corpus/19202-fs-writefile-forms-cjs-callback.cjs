// Corpus 19202: fs callback forms, run in a private mkdtemp directory (no path is printed; filesystem errors print code and syscall only).
const fs = require('fs');
const os = require('os');
const D = fs.mkdtempSync(os.tmpdir() + '/fscb-19202-');
const cb = (tag) => (e) => console.log(tag, e === null ? 'null' : e.code);

const tryit = (tag, f) => { try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code); } };
tryit('nocb', () => fs.writeFile(D + '/n1', 'x'));
tryit('badcb', () => fs.writeFile(D + '/n2', 'x', 5));
tryit('numdata', () => fs.writeFile(D + '/n3', 123, cb('numdata')));
tryit('objdata', () => fs.writeFile(D + '/n4', { a: 1 }, cb('objdata')));
tryit('badenc', () => fs.writeFile(D + '/n5', 'x', 'nope', cb('badenc')));
tryit('badflag', () => fs.writeFile(D + '/n6', 'x', { flag: 'zz' }, cb('badflag')));
tryit('badmode', () => fs.writeFile(D + '/n7', 'x', { mode: 'zz' }, cb('badmode')));
fs.writeFile(D + '/hex', 'deadbeef', 'hex', (e) => {
  cb('hex')(e); console.log('hex-bytes', fs.readFileSync(D + '/hex').toString('hex'));
  fs.writeFile(D + '/b64', 'aGk=', { encoding: 'base64' }, (e2) => {
    cb('b64')(e2); console.log('b64-text', fs.readFileSync(D + '/b64', 'utf8'));
    fs.writeFile(D + '/u16', new Uint16Array([0x4142]), (e3) => {
      cb('u16')(e3); console.log('u16-hex', fs.readFileSync(D + '/u16').toString('hex'));
      fs.writeFile(D + '/dv', new DataView(new ArrayBuffer(3)), (e4) => {
        cb('dataview')(e4); console.log('dv-len', fs.readFileSync(D + '/dv').length);
        fs.writeFile(D + '/ap', 'A', { flag: 'a' }, (e5) => {
          fs.writeFile(D + '/ap', 'B', { flag: 'a' }, (e6) => {
            cb('flag-a')(e6); console.log('ap-text', fs.readFileSync(D + '/ap', 'utf8'));
            fs.writeFile(D + '/ap', 'C', { flag: 'r+' }, (e7) => {
              cb('flag-rplus')(e7); console.log('rplus-text', fs.readFileSync(D + '/ap', 'utf8'));
              fs.writeFile(D + '/fl', 'N', { flush: true }, (e8) => {
                cb('flush')(e8);
                fs.writeFile(D + '/ap', 'Z', { flag: 'ax' }, (e9) => {
                  console.log('ax', e9.code, e9.syscall);
                  const fd = fs.openSync(D + '/fd.txt', 'w');
                  fs.writeFile(fd, 'via-fd', (e10) => {
                    cb('fd-write')(e10); fs.closeSync(fd);
                    console.log('fd-text', fs.readFileSync(D + '/fd.txt', 'utf8'));
                    fs.writeFile(999999, 'bad', (e11) => {
                      console.log('fd-bad', e11.code, e11.syscall);
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
  });
});

