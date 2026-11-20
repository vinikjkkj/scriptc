// assert, trace and the timer/count label warnings go to stderr (not compared here); stdout shows the program ran on.
const run: any = new Function(`
  console.assert(true, "silent");
  console.assert(false, "boom %s", "x");
  console.assert(false);
  console.trace("where", 1);
  console.timeEnd("nope");
  console.timeLog("nope");
  console.countReset("nope");
  console.time("t");
  console.time("t");
  console.group("indented");
  console.error("stderr line");
  console.groupEnd();
  console.log("done");
  return 1;
`);
console.log(run());
