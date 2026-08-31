# The three weighed programs, verbatim from island.test.ts / regex.test.ts.
mkdir -p /g/blocks/twobyte-tmp/size
printf 'console.log("hello", "world");\n' > /g/blocks/twobyte-tmp/size/static.ts
printf 'console.log("a-b c".replace(/[-\s]/g, "_"), /\p{L}+/u.test("h\xc3\xa9llo"));\n' > /g/blocks/twobyte-tmp/size/regex.ts
