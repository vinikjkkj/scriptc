// The mysql2 timezone shape: a sign test on the first unit of an offset
// string, with the empty and absent cases taking the branch they take in JS.
function offsetMinutes(timezone: string): number {
  if (!timezone || timezone === "local") return 0;
  if (timezone !== "Z") {
    return (timezone[0] === "-" ? -1 : 1) * (parseInt(timezone.substring(1, 3), 10) * 60 + parseInt(timezone.substring(4), 10));
  }
  return 1;
}
console.log(offsetMinutes("+05:30"), offsetMinutes("-03:00"), offsetMinutes(""), offsetMinutes("Z"), offsetMinutes("local"));
