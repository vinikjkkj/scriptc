// `this` inside a plain nested function reached the enclosing method's
// receiver whenever that function took a capture.
//
// JS binds `this` afresh in every non-arrow function and only arrows
// inherit it, so `helper`'s `this` here is `undefined` (a class body is
// strict) and the property read throws a TypeError. The capture walk used
// to stop only at a frame that takes NO captures, so a nested function that
// closed over anything at all was threaded the method's receiver and read
// the instance's own field -- a silent wrong answer, not a refusal.
class Holder {
  constructor() {
    this.tag = 'from-instance'
  }

  // helper captures `seen`, so the frame IS lifted.
  captures() {
    const seen = []
    function helper() {
      seen.push(1)
      return this.tag
    }
    try {
      return 'got:' + helper()
    } catch (e) {
      return 'threw:' + (e instanceof TypeError) + ':' + seen.length
    }
  }

  // helper captures nothing: the shape that was already correct.
  plain() {
    function helper() {
      return this.tag
    }
    try {
      return 'got:' + helper()
    } catch (e) {
      return 'threw:' + (e instanceof TypeError)
    }
  }

  // An ARROW does inherit `this`, and must keep doing so.
  arrow() {
    const read = () => this.tag
    return 'arrow:' + read()
  }

  // An arrow nested inside an arrow, still inheriting.
  nestedArrow() {
    const outer = () => {
      const inner = () => this.tag
      return inner()
    }
    return 'nested:' + outer()
  }
}

// NOT covered here: `helper.call(this)`, which hands the receiver in
// explicitly. It is refused loudly today -- "a property read on a dynamic
// Holder is not supported yet" -- and a corpus program has to match Node.


const h = new Holder()
console.log(h.captures())
console.log(h.plain())
console.log(h.arrow())
console.log(h.nestedArrow())
