// Optional chaining through a possibly-undefined intersection value; the refinement member is
// read under a presence test in the same condition.
function find(flag: boolean): (Error & { hint: string }) | undefined {
  if (!flag) return undefined;
  const e = new Error('found') as Error & { hint: string };
  e.hint = 'yes';
  return e;
}
console.log(find(false)?.message ?? 'none');
console.log(find(true)?.message);
const got = find(true);
if (got !== undefined && got.hint !== undefined) console.log(got.hint.length);
