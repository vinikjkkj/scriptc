// the mysql2 binary_parser SC1090 site shape: a generated-source template with ${null} and a field type
function genReader(field) {
  return `packet.readDateTimeString(${parseInt(field.decimals, 10)}, ${null}, ${field.columnType});`;
}
const fields = [{ decimals: "0", columnType: 12 }, { decimals: "6", columnType: 7 }];
for (const f of fields) console.log(genReader(f));
const text = "" + null + undefined;
console.log(text, String(undefined) + null);
