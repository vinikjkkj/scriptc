// pg's stream.js Cloudflare probe: an early `return` guarded by a test that is true
// in every Node (navigator exists and its userAgent is a string), followed by a
// fallback this compiler has no lowering for (Object.defineProperty here; a
// `new Response` in pg). The test folds, so the fallback is dead and not lowered.
'use strict';
function probe() {
  if (typeof navigator === 'object' && navigator !== null && typeof navigator.userAgent === 'string') {
    return navigator.userAgent.startsWith('Node.js/');
  }
  if (typeof Object.defineProperty === 'function') {
    const o = Object.defineProperty({}, 'z', { value: 3 });
    return o.z === 3;
  }
  return false;
}
console.log(probe());
