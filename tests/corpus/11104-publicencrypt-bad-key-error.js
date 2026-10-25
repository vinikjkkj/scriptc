// a malformed key: Node message and code, through a caught error
import * as crypto from "node:crypto";
function run(key) {
  try {
    crypto.publicEncrypt({ key }, Buffer.from('x'));
    return 'no throw';
  } catch (e) {
    return e.name + ' ' + e.code + ' ' + e.message;
  }
}
console.log(run('not a key'));
console.log(run(Buffer.from('garbage')));
