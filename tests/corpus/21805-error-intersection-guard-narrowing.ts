// A user type guard narrows to Error & { tag: string }; a tag written in one place is read after the guard.
function isTagged(e: unknown): e is Error & { tag: string } {
  return e instanceof Error && typeof (e as Error & { tag?: unknown }).tag === 'string';
}
const x = new RangeError('r') as RangeError & { tag: string };
x.tag = 't';
try {
  throw x;
} catch (e) {
  if (isTagged(e)) {
    console.log(e.message, e.name, e.tag, typeof e.stack);
  }
  console.log(e instanceof RangeError);
}
const plain: unknown = new Error('no tag');
console.log(isTagged(plain));
