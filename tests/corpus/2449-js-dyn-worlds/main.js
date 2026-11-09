// The two dynamic worlds in one JS graph, no ICEs anywhere: `this` in
// plain functions is the checked-dynamic AMBIENT receiver (dyn keyed
// reads, never an engine op over a dyn value); rest-args arrays dispatch
// their methods on the runtime receiver kind; and a graph typed by a
// runtime-fenced #private class still builds — the destructuring-param
// function compiles as its own fence body, the plain-param caller links
// against it, and every leftover class-typed slot emits valid code.
'use strict';
import TreePath from "./walker.js";

// ── the ambient receiver ────────────────────────────────────────────────
// Strict-mode plain calls leave `this` undefined, so the read throws V8's
// catchable TypeError, message-exactly.
function unbound() {
  try {
    return this.limit;
  } catch (e) {
    return "caught: " + e.message;
  }
}
console.log(`${unbound()}`);

// Chains throw at the FIRST read, like Node.
function chained() {
  try {
    return this.Parser.prototype;
  } catch (e) {
    return "chain: " + e.message;
  }
}
console.log(`${chained()}`);

// `this` itself is a value: truthiness and typeof see the undefined.
function probe() {
  return (this ? "bound" : "unbound") + "/" + typeof this;
}
console.log(`${probe()}`);

// ── rest-args are checked-dynamic arrays ────────────────────────────────
// `.map`/`.forEach` over one dispatch on the RUNTIME receiver kind (the
// lazy-plugin-table idiom); the callback crosses as a boxed function.
function toLazy(...plugins) {
  const out = plugins.map((p) => "p:" + p);
  return out.join(",");
}
console.log(`${toLazy("alpha", "beta")}`);
console.log(`${toLazy()}`);
console.log(`${toLazy("solo")}`);

function tally(...nums) {
  let sum = 0;
  nums.forEach((n) => {
    sum += n;
  });
  return sum;
}
console.log(`${tally(1, 2, 3.5)}`);

// ── the fenced-class graph ──────────────────────────────────────────────
// None of the fenced code RUNS here — the graph loads, the healthy
// statements print, exactly Node.
/**
 * @param {TreePath} path
 */
function isInWideSentence({ parent: sentenceNode }) {
  return sentenceNode.usesSpaces === undefined;
}

/**
 * @param {TreePath} path
 */
function lineBreakConverts(path) {
  return isInWideSentence(path);
}

/**
 * @param {TreePath} path
 * @returns {string}
 */
function printTree(path) {
  return String(path);
}

console.log(typeof lineBreakConverts, typeof isInWideSentence, typeof printTree);
console.log("graph loaded");
