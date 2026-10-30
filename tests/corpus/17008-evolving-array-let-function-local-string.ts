// A function-local `let` evolving array read by index.
function run() {
  let words = [];
  words.push("alpha");
  words.push("beta");
  console.log(words[1], words.length, words);
}
run();
