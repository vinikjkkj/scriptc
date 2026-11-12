// Runs for ~1.6 s with an idle seam every 100 ms: long enough for the text drop to repeat at its default 500 ms interval but not at 2000 ms.
let n = 0;
const t = setInterval(() => {
  n++;
  if (n === 16) {
    clearInterval(t);
    console.log("done", n);
  }
}, 100);
