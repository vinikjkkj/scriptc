// A 16-bit array over an ODD byte length. Node throws a RangeError at
// run time; scriptc refuses at compile time (the documented stance for
// this syntactic form). This file is the ORACLE half — it is expected to
// be a compile refusal, and lab/fences.sh checks the refusal's advice.
const a = new Int16Array(new ArrayBuffer(5))
console.log(a.length)
