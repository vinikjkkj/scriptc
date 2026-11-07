// A JS `const log = []` that is pushed to and handed WHOLE to parameters declared `string[]`: JS passes the array by reference, so a push inside the
// callee is seen through the binding afterwards (DataHandler's reply log; the typed argument used to be a COPY of the checked-dynamic array).
/** @param {string[]} log */
function add(log) { log.push("x"); }
/** @param {string} replyType @param {string[]} log */
function handle(replyType, log) {
  switch (replyType) {
    case "message": { log.push("m"); break; }
    case "unsubscribe":
    case "punsubscribe": {
      const early = replyType === "punsubscribe";
      if (early) break;
      log.push("u-late");
      break;
    }
    default: { if (!log) return; log.push("d"); }
  }
  return true;
}
const log = [];
add(log);
add(log);
log.push("y");
console.log(log.length, log.join());
const replies = [];
console.log(handle("message", replies), handle("unsubscribe", replies), handle("punsubscribe", replies), handle("x", replies), replies.join());
function local() {
  const seen = [];
  add(seen);
  seen.push("z");
  add(seen);
  return seen.join("") + seen.length;
}
console.log(local());
/** @param {number[]} out */
function fill(out) { out.push(out.length + 1); }
const nums = [];
fill(nums);
fill(nums);
console.log(nums.join(), nums.length);
