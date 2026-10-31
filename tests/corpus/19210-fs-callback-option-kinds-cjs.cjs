// Corpus 19210: fs callback form of x1; works in a temp directory under cwd and removes it.
const fs = require('fs');
const D = 'fsw-19210';
fs.rmSync(D, { recursive: true, force: true });
fs.mkdirSync(D);
const tryit = (tag, f) => { try { f(); } catch (e) { console.log(tag, 'THROW', e.name, e.code, e.message); } };
const BAD_FLAG = { flag: true };
const BAD_FLUSH = { flush: 'yes' };
const o = BAD_FLAG;
tryit('var-bool', () => fs.writeFile(D + '/x1-a', 'x', o, (e) => { console.log('cb', e && e.code); fs.rmSync(D, { recursive: true, force: true }); }));
tryit('lit-bool', () => fs.writeFile(D + '/x1-b', 'x', BAD_FLAG, (e) => console.log('cb2', e && e.code)));
tryit('lit-flush', () => fs.writeFile(D + '/x1-c', 'x', BAD_FLUSH, (e) => console.log('cb3', e && e.code)));
console.log('main end');
