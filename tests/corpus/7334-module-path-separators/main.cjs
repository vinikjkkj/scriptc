// The module-location constants are baked from the CHECKER's file name,
// which is always forward-slashed, while Node hands back a NATIVE path. On
// a Windows target that difference is invisible to every other entry in
// this corpus, because they are all separator-agnostic by accident:
// path.dirname and fs accept either separator on win32, and `typeof` and
// `endsWith('name.cjs')` cannot see it at all. This one is deliberately
// separator-SENSITIVE, so the answers below differ between a native path
// and a forward-slashed one.
//
// What it caught: __dirname compiled to 'G:/blocks/...' where Node prints
// 'G:\blocks\...', so includes('\\') was false where Node says true and
// path.join(__dirname, base) === __filename was false where Node says
// true -- at exit 0, with no diagnostic.
const path = require('node:path');
const SEP = path.sep;

console.log('A1', __dirname.includes(SEP));
console.log('A2', __filename.includes(SEP));
console.log('A3', path.join(__dirname, path.basename(__filename)) === __filename);
console.log('A4', __filename.split(SEP).length === __dirname.split(SEP).length + 1);
console.log('A5', path.resolve(__filename) === __filename);
console.log('A6', path.normalize(__filename) === __filename);
// The separator this platform does NOT use must be absent.
console.log('A7', __dirname.includes(SEP === '/' ? '\\' : '/'));
console.log('A8', path.isAbsolute(__dirname), path.isAbsolute(__filename));

// Every OTHER site that bakes a path must agree with these, or the program
// sees two spellings of one file. require.main.filename is baked by its own
// lowering: converting __filename alone made this false where Node says
// true, and corpus 1629/4771 caught it.
console.log('A9', require.main.filename === __filename);
console.log('A10', path.dirname(require.main.filename) === __dirname);
