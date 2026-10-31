// Corpus 20017: TypeScript stat callback with the guarded err read; the Stats value answers on success.
import * as fs from 'fs';
import * as os from 'os';
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20017-');
fs.stat(D + '/missing', (err, s) => {
  if (err !== null) console.log('err', err.code);
  else console.log('ok', s.size);
  fs.rmSync(D, { recursive: true, force: true });
});
