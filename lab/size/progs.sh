# The three weighed programs, verbatim from island.test.ts / regex.test.ts.
mkdir -p ${BLOCKS_ROOT:-<blocks>}/twobyte-tmp/size
printf 'console.log("hello", "world");\n' > ${BLOCKS_ROOT:-<blocks>}/twobyte-tmp/size/static.ts
printf 'console.log("a-b c".replace(/[-\s]/g, "_"), /\p{L}+/u.test("h\xc3\xa9llo"));\n' > ${BLOCKS_ROOT:-<blocks>}/twobyte-tmp/size/regex.ts
