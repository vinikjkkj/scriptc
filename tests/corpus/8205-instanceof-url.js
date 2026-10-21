// `x instanceof URL` over the `string | URL` parameter ws's WebSocket takes:
// a runtime tag test over the union, a constant over a URL-typed value.

/**
 * @param {string | URL} address
 * @returns {string}
 */
function hostOf(address) {
  if (address instanceof URL) return 'url:' + address.hostname;
  return 'str:' + new URL(address).hostname;
}

console.log(hostOf('http://a.example/x'));
console.log(hostOf(new URL('http://b.example/y')));

const u = new URL('http://d.example/');
console.log(u instanceof URL, {} instanceof URL);
