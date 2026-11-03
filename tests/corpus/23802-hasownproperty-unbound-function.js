// hasOwnProperty read off dyn values is the ONE unbound Object.prototype function.
function ext(t, s) { for (var k in s) t[k] = s[k]; return t }
function P() { ext(this, { a: 1, b: 2 }) }
P.prototype.same = function () { return this.hasOwnProperty === this.hasOwnProperty }
P.prototype.probe = function (other) { return ['a', 'b', 'c'].filter(this.hasOwnProperty, other) }
P.prototype.viaCall = function () { var h = this.hasOwnProperty; return h.call({ c: 1 }, 'c') + ',' + h.call(this, 'a') + ',' + h.call(this, 'toString') }
var p = new P()
console.log(p.same(), p.probe({ b: 1, c: 2 }), p.probe(p), p.viaCall())
/** @type {any} */ var o = { x: 1 }
/** @type {any} */ var arr = [1, 2]
/** @type {any} */ var s = 'abc'
console.log(o.hasOwnProperty === arr.hasOwnProperty, o.hasOwnProperty === s.hasOwnProperty)
console.log(typeof o.hasOwnProperty, o.hasOwnProperty.name, o.hasOwnProperty.length)
console.log(['x', 'y'].filter(o.hasOwnProperty, o), ['0', 'length', '2'].filter(arr.hasOwnProperty, arr))
console.log(['0', '1', 'length'].map(s.hasOwnProperty, s))
try { ['a'].filter(o.hasOwnProperty) } catch (e) { console.log(e.constructor.name, e.message) }
try { ['a'].filter(o.noSuchThing, o) } catch (e) { console.log(e.constructor.name, e.message) }
try { [].forEach(o.noSuchThing, o) } catch (e) { console.log(e.constructor.name, e.message) }
console.log(o.hasOwnProperty('x'), o.hasOwnProperty('y'), arr.hasOwnProperty(1), s.hasOwnProperty('length'))
