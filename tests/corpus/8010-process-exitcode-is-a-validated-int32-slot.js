// @exit: 9
// process.exitCode: undefined until assigned, then Node's int32 slot. The
// setter validates (a bad value throws catchably and leaves the slot as it
// was), converts integer-valued numeric strings, clears on null/undefined,
// stores ToInt32 of the number. The 'exit' listener sees the code and may
// assign it again; the process ends with the last assignment. Node is the
// oracle for stdout AND the exit status.
"use strict";

function assign(v, label) {
  try {
    process.exitCode = v;
    console.log("ok", label, process.exitCode, typeof process.exitCode);
  } catch (e) {
    console.log(e.name, e.code, e.message, "| now", process.exitCode);
  }
}

console.log(process.exitCode);
assign(5, "5");
assign("7", "'7'");
assign("5.5", "'5.5'");
assign("", "''");
assign("  ", "'  '");
assign("0x10", "'0x10'");
assign("1e3", "'1e3'");
assign("x", "'x'");
assign(5.5, "5.5");
assign(NaN, "NaN");
assign(Infinity, "Infinity");
assign(true, "true");
assign({}, "{}");
assign([3], "[3]");
assign(1n, "1n");
assign(function () {}, "fn");
assign(2 ** 31, "2**31");
assign(2 ** 32 + 5, "2**32+5");
assign(1e10, "1e10");
assign(2 ** 53, "2**53");
assign(-1, "-1");
assign(-0, "-0");
assign(null, "null");
assign(undefined, "undefined");
assign(4, "4");

process.on("exit", (code) => {
  console.log("exit listener", code, process.exitCode);
  process.exitCode = 9;
});
