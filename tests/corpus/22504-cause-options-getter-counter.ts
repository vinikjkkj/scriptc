// The cause getter runs exactly once, during construction.
let reads = 0;
const opts = { get cause(): unknown { reads++; return 'g' + reads; } };
console.log('before', reads);
const e = new Error('getter', opts);
console.log('after', reads, e.message, String((e as Error & { cause?: unknown }).cause), reads);
