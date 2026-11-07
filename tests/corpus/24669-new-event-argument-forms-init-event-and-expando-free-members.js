/** @param {Event} e */
function show(e) { return [e.type, e.bubbles, e.cancelable, e.composed, e.defaultPrevented, e.isTrusted].join(','); }
console.log(show(new Event('a')), show(new Event(5)), show(new Event(null)), show(new Event(undefined)), show(new Event(true)));
console.log(show(new Event('x', undefined)), show(new Event('x', null)), show(new Event('x', {bubbles: 1, cancelable: 'yes', composed: 0})));
const opts = { bubbles: true, cancelable: true, extra: 9 };
console.log(show(new Event('o', opts)));
const dynOpts = JSON.parse('{"composed": true, "cancelable": 1}');
console.log(show(new Event('d', dynOpts)));
for (const arg of [5, 'x', true]) { try { new Event('x', arg); console.log('ok', arg) } catch (x) { console.log(x.name, x.code, x.message) } }
try { new Event() } catch (x) { console.log(x.name, x.code, x.message) }
const e = new Event('a', { cancelable: true });
e.preventDefault();
e.initEvent('b', true, false);
console.log(show(e), e.returnValue);
try { e.initEvent() } catch (x) { console.log(x.name, x.code, x.message) }
console.log(e.NONE, e.AT_TARGET, Event.NONE, Event.AT_TARGET);
const e2 = new Event('k'); e2.cancelBubble = true; console.log(e2.cancelBubble); e2.cancelBubble = false; console.log(e2.cancelBubble);
console.log(e instanceof Event, [e] instanceof Event);
