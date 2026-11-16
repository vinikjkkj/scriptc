// Runs for ~500 ms with an idle seam every 100 ms: the first drop lands at the second seam (SCR_TEXT_DROP_AFTER_MS is 0) and the repeat is due 500 ms
// after it, past the program's end.
let n = 0;
const t = setInterval(() => {
  n++;
  if (n === 5) {
    clearInterval(t);
    console.log("done", n);
  }
}, 100);
