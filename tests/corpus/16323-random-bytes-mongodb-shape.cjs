// The mongodb random-bytes shape (utils.ts): the global crypto's
// getRandomValues called inside a Promise over a fresh Uint8Array, and
// again inside a plain function that returns the array it filled. The
// values are random: lengths, classes, and the fill's identity print.
const randomBytes = (size) => {
  return Promise.resolve(crypto.getRandomValues(new Uint8Array(size)));
};
function sixteen() {
  const result = crypto.getRandomValues(new Uint8Array(16));
  return result;
}
randomBytes(9).then((r) => console.log('mongo', r.length, r instanceof Uint8Array));
console.log('sixteen', sixteen().length, sixteen() instanceof Uint8Array);
const filled = new Uint8Array(5);
console.log('identity', crypto.getRandomValues(filled) === filled);
