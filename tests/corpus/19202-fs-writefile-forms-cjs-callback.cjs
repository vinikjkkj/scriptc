// Corpus 19202: fs callback form of w2 (rows 19202); operates in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19202';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const tryit = (tag, f) => { try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); } };
tryit('nocb', () => fs.writeFile(D + '/w2-nocb', 'x'));
tryit('badcb', () => fs.writeFile(D + '/w2-nocb', 'x', 5));
tryit('numdata', () => fs.writeFile(D + '/w2-num', 123, (e) => console.log('numdata-cb', e && e.code)));
tryit('objdata', () => fs.writeFile(D + '/w2-obj', { a: 1 }, (e) => console.log('objdata-cb', e && e.code)));
tryit('badenc', () => fs.writeFile(D + '/w2-enc', 'x', 'nope', (e) => console.log('badenc-cb', e && e.code)));
tryit('badopt', () => fs.writeFile(D + '/w2-opt', 'x', { flag: 'zz' }, (e) => console.log('badflag-cb', e && e.code)));
tryit('badmode', () => fs.writeFile(D + '/w2-mode', 'x', { mode: 'zz' }, (e) => console.log('badmode-cb', e && e.code)));
fs.writeFile(D + '/w2-hex', 'deadbeef', 'hex', (e) => {
  console.log('hex', e, fs.readFileSync(D + '/w2-hex').toString('hex'));
  fs.writeFile(D + '/w2-b64', 'aGk=', { encoding: 'base64' }, (e2) => {
    console.log('b64', e2, fs.readFileSync(D + '/w2-b64', 'utf8'));
    fs.writeFile(D + '/w2-ta', new Uint16Array([0x4142]), (e3) => {
      console.log('u16', e3, fs.readFileSync(D + '/w2-ta').toString('hex'));
      fs.writeFile(D + '/w2-dv', new DataView(new ArrayBuffer(3)), (e4) => {
        console.log('dataview', e4, fs.readFileSync(D + '/w2-dv').length);
        fs.writeFile(D + '/w2-ap', 'A', { flag: 'a' }, (e5) => {
          fs.writeFile(D + '/w2-ap', 'B', { flag: 'a' }, (e6) => {
            console.log('flag-a', e6, fs.readFileSync(D + '/w2-ap', 'utf8'));
            fs.writeFile(D + '/w2-ap', 'C', { flag: 'r+' }, (e7) => {
              console.log('flag-rplus', e7 && e7.code, e7 && e7.syscall, fs.readFileSync(D + '/w2-ap', 'utf8'));
              fs.writeFile(D + '/w2-fl', 'N', { flush: true }, (e8) => {
                console.log('flush', e8, fs.readFileSync(D + '/w2-fl', 'utf8'));
                fs.writeFile(D + '/w2-ap', 'Z', { flag: 'ax' }, (e9) => {
                  console.log('ax', e9 && e9.code, e9 && e9.syscall, e9 && e9.path, e9 && e9.message);
                  const fd = fs.openSync(D + '/w2-fd', 'w');
                  fs.writeFile(fd, 'via-fd', (e10) => {
                    console.log('fd-write', e10, fs.readFileSync(D + '/w2-fd', 'utf8'));
                    fs.closeSync(fd);
                    fs.writeFile(999999, 'bad', (e11) => {
                      console.log('fd-bad', e11 && e11.code, e11 && e11.errno, e11 && e11.syscall, e11 && e11.path, Object.keys(e11 || {}).sort().join(','));
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
});
console.log('main end');
