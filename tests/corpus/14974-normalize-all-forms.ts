// String.prototype.normalize in all four forms: canonical composition and
// decomposition, compatibility mappings (ligature, roman numeral, full-width),
// Hangul syllables, and a reordering of combining marks.
function cps(s: string): string {
  const out: string[] = []
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i).toString(16))
  return out.join(' ')
}
const samples = ['é', 'é', 'ﬁ', 'Ⅷ', 'ＡＢ', '가', '가', 'ạ́', 'ạ́', 'ABC']
for (const s of samples) {
  console.log(cps(s.normalize('NFC')), '|', cps(s.normalize('NFD')), '|', cps(s.normalize('NFKC')), '|', cps(s.normalize('NFKD')))
}
