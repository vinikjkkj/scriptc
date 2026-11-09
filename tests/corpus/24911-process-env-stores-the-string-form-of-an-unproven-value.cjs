// process.env stores String(value): a parameter nothing proves is a string (a JSDoc claim that a number and undefined contradict) is converted, not refused.
/** @param {string} v */
function put(v) {
  process.env.SCRIPTC_PE_A = v;
  process.env["SCRIPTC_PE_B"] = v;
}
const o = { put };
put("x");
console.log(process.env.SCRIPTC_PE_A, process.env.SCRIPTC_PE_B);
put(5);
console.log(process.env.SCRIPTC_PE_A, process.env.SCRIPTC_PE_B, typeof process.env.SCRIPTC_PE_A);
put(undefined);
console.log(process.env.SCRIPTC_PE_A);
