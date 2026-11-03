// @ts-nocheck
'use strict';

// The mysql2 charset_encodings shape: a literal table, then fixed id blocks written past the
// end of it (each block of ids is a run of writes beyond the previous length, so the table has
// holes between the blocks), exported whole.
const encodings = [
  'utf8',
  'big5',
  'latin2',
  'dec8',
  'cp850',
  'latin1',
  'hp8',
  'koi8r',
];

const uca1400Blocks = [
  [20, 'cesu8'],
  [30, 'utf8'],
  [40, 'ucs2'],
  [50, 'utf16'],
  [60, 'utf32'],
];
for (const [start, encoding] of uca1400Blocks) {
  for (let id = start; id < start + 4; id++) {
    encodings[id] = encoding;
  }
}

module.exports = encodings;
