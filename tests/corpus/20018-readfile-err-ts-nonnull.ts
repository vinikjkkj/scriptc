// Corpus 20018: TypeScript readFile callback with the non-null assertion on the error (the error path only).
import * as fs from 'fs';
import * as os from 'os';
const D = fs.mkdtempSync(os.tmpdir() + '/errcb-20018-');
fs.readFile(D + '/missing', 'utf8', (err, data) => {
  console.log(err!.code, data === undefined);
  fs.rmSync(D, { recursive: true, force: true });
});
