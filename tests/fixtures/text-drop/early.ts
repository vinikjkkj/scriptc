// Runs for ~150 ms with an idle seam every 50 ms: shorter than the 200 ms delay the first drop used to wait, so the drop at the second seam (SCR_TEXT_DROP_AFTER_MS is 0)
// is the only thing that can make this program print a [textdrop] line.
let n = 0;
const t = setInterval(() => {
  n++;
  if (n === 3) {
    clearInterval(t);
    console.log("done", n);
  }
}, 50);
