// the documented result is a Function, the function returned has its own properties and returns nothing
/**
 * @param {String} namespace
 * @return {Function}
 */
function create(namespace) {
  function debug(...args) {
    if (!debug.enabled) {
      return;
    }
  }
  debug.namespace = namespace;
  debug.color = namespace.length;
  return debug;
}
const d = create("abc");
console.log(d.namespace, d.color, typeof d);
d.namespace = "changed";
console.log(d.namespace);
