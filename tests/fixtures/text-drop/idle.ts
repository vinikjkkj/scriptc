// Runs for ~600 ms with an idle seam every 100 ms: long enough to pass the text-drop delay and reach the seam after it.
let n = 0;
const t = setInterval(() => {
  n++;
  if (n === 6) {
    clearInterval(t);
    console.log("done", n);
  }
}, 100);
