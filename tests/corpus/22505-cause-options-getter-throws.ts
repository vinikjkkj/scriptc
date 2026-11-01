// A cause getter that throws propagates its exception out of the constructor.
const bad = { get cause(): unknown { throw new TypeError('boom'); } };
try {
  const e = new Error('t', bad);
  console.log('no throw', e.message);
} catch (err) {
  console.log('caught', (err as Error).message);
}
