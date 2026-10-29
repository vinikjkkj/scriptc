// An array of records with optional members: each element answers its own absent keys.
const rows: { a?: number; name?: string }[] = JSON.parse('[{}, {"a": 2}, {"name": "z"}]');
console.log(rows.length, rows[0]!.a, rows[1]!.a, rows[2]!.name, rows[0]!.name);
console.log(JSON.stringify(rows), rows);
