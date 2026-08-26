// The REMEDY the field fences name, compiled. `this.m = new Map()` in a JS
// class has no inference a static slot can hold — `Map<any, any>`'s key
// type does not compile — and both fences that meet it now say so and
// point at the JSDoc annotation. This is that annotation, driven, so the
// advice is checked by running it rather than by believing it.
//
// The two refusals it replaces:
//   - in a METHOD: SC1090, "fields holding a 'Map<any, any>' the inference
//     cannot compile (moving the assignment to the constructor's top level
//     does NOT help ...)";
//   - at the constructor's TOP LEVEL: SC2009, "the Map shape is supported,
//     but its key type 'any' does not compile". Before, that one compiled
//     clean and answered `undefined` for `m.size` and "this.m.set is not a
//     function" for the write.
class Store {
  constructor() {
    /** @type {Map<string, number>} */
    this.m = new Map()
    /** @type {Set<string>} */
    this.s = new Set()
    this.name = 'store'
  }

  put(k, v) {
    this.m.set(k, v)
    this.s.add(k)
  }
}

const st = new Store()
console.log('empty', st.m.size, st.s.size, st.name)
st.put('a', 1)
st.put('b', 2)
console.log('filled', st.m.size, st.s.size)
console.log('read', st.m.get('a'), st.m.get('b'), st.m.get('missing'))
console.log('has', st.s.has('a'), st.s.has('zz'))
console.log('keys', [...st.m.keys()].join(','))
console.log('values', [...st.m.values()].join(','))
st.m.delete('a')
console.log('deleted', st.m.size, st.m.get('a'), st.m.has('a'))

// A RegExp field is the same story: annotated, it is a real slot.
// (`new Date(...)` has no lowering at all yet — SC2020, a separate gap.)
class Matcher {
  constructor() {
    /** @type {RegExp} */
    this.re = /ab+/
    this.tag = 'm'
  }
  hit(s) {
    return this.re.test(s)
  }
}
const matcher = new Matcher()
console.log('regex', matcher.hit('xabby'), matcher.hit('zz'), matcher.re.source, matcher.tag)

// A second instance keeps its own containers.
const other = new Store()
other.put('z', 9)
console.log('independent', st.m.size, other.m.size, other.m.get('z'), st.m.get('z'))
