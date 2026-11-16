// A Record<string, V> filled by assignment with run-time keys, returned as an interface that declares the same
// optional members in ANOTHER order (zapo's parsePrivacySettings). Every enumeration surface prints the fill order,
// per instance: two calls fill in two orders, one leaves members absent.
type Val = 'all' | 'contacts' | 'none';
interface Settings {
  readonly about?: Val;
  readonly callAdd?: Val;
  readonly defenseMode?: Val;
  readonly groupAdd?: Val;
  readonly lastSeen?: Val;
  readonly messages?: Val;
  readonly online?: Val;
  readonly profilePicture?: Val;
  readonly readReceipts?: Val;
}
const NAMES: Record<string, string | undefined> = { readreceipts: 'readReceipts', last: 'lastSeen', online: 'online', profile: 'profilePicture', status: 'about', groupadd: 'groupAdd', calladd: 'callAdd', messages: 'messages', stickers: 'defenseMode' };
function parse(rows: [string, Val][]): Settings {
  const settings: Record<string, Val> = {};
  for (const [name, value] of rows) {
    const key = NAMES[name];
    if (!key) continue;
    settings[key] = value;
  }
  return settings;
}
const first: [string, Val][] = [['readreceipts', 'all'], ['last', 'contacts'], ['online', 'all'], ['profile', 'contacts'], ['status', 'none'], ['groupadd', 'all'], ['calladd', 'contacts'], ['messages', 'all'], ['stickers', 'none']];
const second: [string, Val][] = [['stickers', 'all'], ['messages', 'none'], ['online', 'contacts'], ['bogus', 'none'], ['last', 'all']];
for (const rows of [first, second]) {
  const s = parse(rows);
  console.log(JSON.stringify(s));
  console.log(Object.keys(s).join(','));
  console.log(JSON.stringify(Object.entries(s)));
  console.log(s);
}
