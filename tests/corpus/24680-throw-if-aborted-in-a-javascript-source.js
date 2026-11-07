/** @param {AbortSignal} s */
function check(s) { s.throwIfAborted(); return 'fine'; }
const c = new AbortController();
console.log(check(c.signal));
c.abort(new TypeError('js reason'));
try { check(c.signal); } catch (e) { console.log(e.name, e.message); }
