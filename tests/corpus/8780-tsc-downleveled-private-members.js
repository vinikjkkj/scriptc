"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var _Counter_instances, _a, _Counter_count, _Counter_log, _Counter_last, _Counter_made, _Counter_LIMITS, _Counter_note, _Counter_bump, _Counter_double_get, _Counter_double_set, _Counter_limit, _Loud_shout;
class Counter {
    constructor(name) {
        var _b, _c;
        _Counter_instances.add(this);
        _Counter_count.set(this, 0);
        _Counter_log.set(this, []);
        _Counter_last.set(this, undefined);
        this.name = name;
        __classPrivateFieldSet(_b = _a, _a, (_c = __classPrivateFieldGet(_b, _a, "f", _Counter_made), _c++, _c), "f", _Counter_made);
        __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_note).call(this, "init " + name);
    }
    inc() {
        return __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_bump).call(this, 1, "inc");
    }
    deferred(by) {
        const f = __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_bump).bind(this, by, "def");
        return () => f();
    }
    setDouble(v) {
        __classPrivateFieldSet(this, _Counter_instances, v, "a", _Counter_double_set);
        return __classPrivateFieldGet(this, _Counter_instances, "a", _Counter_double_get);
    }
    limit(i) {
        return __classPrivateFieldGet(_a, _a, "m", _Counter_limit).call(_a, i);
    }
    last() {
        return __classPrivateFieldGet(this, _Counter_last, "f");
    }
    dump() {
        return this.name + " " + __classPrivateFieldGet(this, _Counter_count, "f") + " " + __classPrivateFieldGet(this, _Counter_log, "f").join(",") + " made=" + __classPrivateFieldGet(_a, _a, "f", _Counter_made);
    }
}
_a = Counter, _Counter_count = new WeakMap(), _Counter_log = new WeakMap(), _Counter_last = new WeakMap(), _Counter_instances = new WeakSet(), _Counter_note = function _Counter_note(msg) {
    __classPrivateFieldGet(this, _Counter_log, "f").push(msg);
}, _Counter_bump = function _Counter_bump(by, tag) {
    __classPrivateFieldSet(this, _Counter_count, __classPrivateFieldGet(this, _Counter_count, "f") + by, "f");
    __classPrivateFieldSet(this, _Counter_last, by, "f");
    __classPrivateFieldGet(this, _Counter_instances, "m", _Counter_note).call(this, tag + ":" + __classPrivateFieldGet(this, _Counter_count, "f"));
    return __classPrivateFieldGet(this, _Counter_count, "f");
}, _Counter_double_get = function _Counter_double_get() {
    return __classPrivateFieldGet(this, _Counter_count, "f") * 2;
}, _Counter_double_set = function _Counter_double_set(v) {
    __classPrivateFieldSet(this, _Counter_count, v / 2, "f");
}, _Counter_limit = function _Counter_limit(i) {
    return __classPrivateFieldGet(_a, _a, "f", _Counter_LIMITS)[i % __classPrivateFieldGet(_a, _a, "f", _Counter_LIMITS).length];
};
_Counter_made = { value: 0 };
_Counter_LIMITS = { value: [10, 20, 30] };
class Loud extends Counter {
    constructor(name) {
        super(name);
        _Loud_shout.set(this, "!");
        __classPrivateFieldSet(this, _Loud_shout, __classPrivateFieldGet(this, _Loud_shout, "f") + "!", "f");
    }
    loud() {
        return this.dump() + __classPrivateFieldGet(this, _Loud_shout, "f");
    }
}
_Loud_shout = new WeakMap();
const a = new Counter("a");
a.inc();
a.inc();
const d = a.deferred(5);
console.log(d(), d());
console.log(a.setDouble(40), a.last());
console.log(a.limit(1), a.limit(4));
const b = new Counter("b");
b.inc();
console.log(a.dump());
console.log(b.dump());
const l = new Loud("l");
l.inc();
console.log(l.loud());
