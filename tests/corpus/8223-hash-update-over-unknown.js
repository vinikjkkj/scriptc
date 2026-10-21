import { createHash } from 'node:crypto';

function sha1(msg, msg1) {
  const hash = createHash('sha1');
  hash.update(msg);
  if (msg1) {
    hash.update(msg1);
  }
  return hash.digest('hex');
}

function sha256Chain(data) {
  return createHash('sha256').update(data).digest('hex');
}

function md5Raw(data) {
  return createHash('md5').update(data).digest().length;
}

console.log(sha1('abc'));
console.log(sha1(Buffer.from('abc'), 'def'));
console.log(sha1(new Uint8Array([1, 2, 3]), Buffer.from([4])));
console.log(sha256Chain('x'), sha256Chain(Buffer.from('x')));
console.log(md5Raw('hello'));
for (const bad of [5, [1, 2], { a: 1 }, null]) {
  try {
    sha256Chain(bad);
    console.log('no throw');
  } catch (e) {
    console.log(e.code, e.message);
  }
}
