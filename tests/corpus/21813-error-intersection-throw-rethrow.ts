// An intersection-typed value thrown, caught, read, and rethrown to an outer handler.
function boom(): never {
  const e = new Error('inner') as Error & { level: number };
  e.level = 2;
  throw e;
}
try {
  try {
    boom();
  } catch (e) {
    const x = e as Error & { level: number };
    console.log('inner', x.message, x.level);
    throw x;
  }
} catch (outer) {
  const y = outer as Error & { level: number };
  console.log('outer', y.name, y.level);
}
