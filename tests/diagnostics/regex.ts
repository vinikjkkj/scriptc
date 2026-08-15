// The regex slice fences. test() on a g/y-flagged literal is the
// statefulness fence (lastIndex is not modeled); the d flag is outside
// the slice (the v flag is IN it now -- corpus 3811 -- and the /v line
// below is here on purpose, producing no diagnostic, so that a future
// regression puts one back); .groups needs a statically-known regex (named
// capture groups themselves compile — corpus 2604); method-as-value has
// no value form; regexes stay out of union arms (ARRAYS of regexes
// compile — corpus 2448).
const g = /ab/g.test("abab");
const y = /ab/y.test("abab");
const indices = /cat/d;
const sets = /[\p{L}]/v;
const asValue = /x/.test;
const maybe: RegExp | undefined = /a/;
function readGroups(re: RegExp): void {
  const m = re.exec("2024-07");
  if (m) console.log(m.groups);
}
readGroups(/(?<year>\d{4})/);
