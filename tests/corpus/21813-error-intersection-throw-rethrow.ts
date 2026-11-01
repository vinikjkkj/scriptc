// An intersection-typed value thrown, caught, guarded, read, and rethrown to an outer handler.
type Leveled = Error & { level: number };
function isLeveled(e: unknown): e is Leveled {
  return e instanceof Error && typeof (e as unknown as { level: unknown }).level === 'number';
}
function boom(): never {
  const e = new Error('inner') as Leveled;
  e.level = 2;
  throw e;
}
try {
  try {
    boom();
  } catch (e) {
    if (isLeveled(e)) console.log('inner', e.message, e.level);
    throw e;
  }
} catch (outer) {
  if (isLeveled(outer)) console.log('outer', outer.name, outer.level);
}
