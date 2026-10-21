// The fs argument-validation ladders that END IN A REAL OPERATION: misuse
// of these implemented-namespace fs APIs answers Node's exact typed errors
// (ERR_INVALID_ARG_TYPE / ERR_INVALID_ARG_VALUE / ERR_OUT_OF_RANGE) —
// exists' callback contract (and its REAL async answers, including the
// synchronous false for unvalidatable paths, Node's own wart) and the
// lchmodSync / promises.lchmod value ladders (octal strings, uint32
// range). The calls whose valid path has no lowering (mkdtemp, readFile,
// opendirSync, watchFile, the stream option forms, fs.read, lchmod with a
// callback) are not here: they are refused at compile time, pinned by
// tests/diagnostics/js-fs-calls-with-no-real-operation-behind-the-validation.cjs.
'use strict';
const fs = require('fs');
const { promises } = fs;
const show = (fn) => {
  try {
    const r = fn();
    console.log('ret', typeof r === 'string' ? 'string' : r);
  } catch (e) {
    console.log(`${e.name}|${e.code}|${e.message}`);
  }
};

// exists: the one throwing arm is the callback contract
show(() => fs.exists(__filename));
show(() => fs.exists());
show(() => fs.exists(__filename, {}));

// lchmodSync: per-platform, exactly like Node
show(() => fs.lchmodSync(1));
show(() => fs.lchmodSync([]));
show(() => fs.lchmodSync(__filename, false));
show(() => fs.lchmodSync(__filename, '123x'));
show(() => fs.lchmodSync(__filename, -1));
show(() => fs.lchmodSync(__filename, 2 ** 32));
// exists' synchronous false for a path getValidatedPath rejects — Node
// calls back before returning
fs.exists({}, (y) => console.log('cb invalid', y));

(async () => {
  try { await promises.lchmod(__filename, {}); } catch (e) { console.log('rejected', e.code); }
  try { await promises.lchmod(__filename, -1); } catch (e) { console.log('rejected', e.code, e.message); }
  // exists' real async answers. Registering after both rejections orders
  // these against the rejections, but two in-flight threadpool stats have
  // no order relative to EACH OTHER — Node itself returns them reversed
  // about once in forty runs. Chained, so the pair is sequenced by the
  // callback rather than by which worker thread finishes first.
  fs.exists(__filename, (y) => {
    console.log('cb file', y);
    fs.exists(`${__filename}-NO`, (n) => console.log('cb missing', n));
  });
})();
console.log('sync tail');
