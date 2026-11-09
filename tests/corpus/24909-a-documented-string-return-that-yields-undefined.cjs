// A function whose JSDoc says it returns a String but whose body returns a value that may be undefined (the debug package's load() returns
// process.env.DEBUG): the caller sees undefined when nothing is set, and the value when it is. The JSDoc is documentation, not a contract.
/**
 * @return {String} the persisted value
 */
function load() {
  return process.env.SCRIPTC_NO_SUCH_VAR_24909;
}
/**
 * @return {String} the value set below
 */
function loadSet() {
  return process.env.SCRIPTC_SET_VAR_24909;
}
process.env.SCRIPTC_SET_VAR_24909 = "on";
const missing = load();
console.log(typeof missing, missing === undefined, load() || "fallback");
console.log(typeof loadSet(), loadSet(), `${loadSet()}`.length);
const holder = { load, loadSet };
console.log(typeof holder.load(), holder.loadSet());
