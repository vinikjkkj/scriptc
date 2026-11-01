// Error(message, options) without new takes the same options path.
const opts = { cause: 'called' };
const e = Error('plain call', opts);
console.log(e.message, String((e as Error & { cause?: unknown }).cause));
