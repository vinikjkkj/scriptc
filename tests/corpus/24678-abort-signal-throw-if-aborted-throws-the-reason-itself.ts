// AbortSignal.throwIfAborted: throws signal.reason itself when aborted, returns undefined otherwise.
const c = new AbortController();
console.log(c.signal.throwIfAborted());
function guard(s: AbortSignal): string {
  s.throwIfAborted();
  return 'not aborted';
}
console.log(guard(c.signal));
c.abort();
try { guard(c.signal); } catch (e) { console.log('default', (e as Error).name, (e as Error) === (c.signal.reason as Error)); }
const c2 = new AbortController();
const err = new Error('mine');
c2.abort(err);
try { c2.signal.throwIfAborted(); } catch (e) { console.log('same error', (e as Error) === err, (e as Error).message); }
const c3 = new AbortController();
c3.abort('plain string');
try { c3.signal.throwIfAborted(); } catch (e) { console.log('string reason', e); }
const c4 = new AbortController();
c4.abort(42);
try { c4.signal.throwIfAborted(); } catch (e) { console.log('number reason', e); }
async function run(s: AbortSignal): Promise<number> {
  s.throwIfAborted();
  return 1;
}
run(c4.signal).then((v) => console.log('no'), (e) => console.log('async rejected with', e));
run(new AbortController().signal).then((v) => console.log('async ok', v));
