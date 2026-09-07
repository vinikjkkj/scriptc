// Writes the lane-A drivers. Kept as a script so the drivers are reproducible
// rather than hand-typed: every store driver has the SAME shape, so a
// difference between two packages is the package, not the driver.
import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const DIR = "<blocks>/pkgstatus3-lab/napp/drivers";
mkdirSync(DIR, { recursive: true });
for (const f of readdirSync(DIR)) rmSync(`${DIR}/${f}`);

const DOMAINS = [
  ["auth", "stores"], ["preKey", "stores"], ["session", "stores"], ["identity", "stores"],
  ["signal", "stores"], ["senderKey", "stores"], ["appState", "stores"], ["messages", "stores"],
  ["threads", "stores"], ["contacts", "stores"], ["privacyToken", "stores"],
  ["retry", "caches"], ["groupMetadata", "caches"], ["chatMetadata", "caches"],
  ["deviceList", "caches"], ["messageSecret", "caches"],
];

function storeDriver(pkg, factory, configLiteral) {
  const L = [];
  L.push(`// pkgstatus lane-A driver, ${pkg}.`);
  L.push(`// Realistic consumer shape: call the package's own factory, then take one`);
  L.push(`// store out of every domain it hands back, so the store constructors and`);
  L.push(`// their field initialisers are REACHED rather than merely named.`);
  L.push(`import { ${factory} } from '${pkg}'`);
  L.push("");
  L.push(`const r = ${factory}(${configLiteral})`);
  L.push(`const s = r.stores`);
  L.push(`const c = r.caches`);
  for (const [d, group] of DOMAINS) {
    L.push(`console.log('${d}=' + typeof ${group === "stores" ? "s" : "c"}.${d}('s1'))`);
  }
  L.push("");
  return L.join("\n");
}

writeFileSync(`${DIR}/store-sqlite.ts`,
  storeDriver("@zapo-js/store-sqlite", "createSqliteStore", "{ path: ':memory:' }"));
writeFileSync(`${DIR}/store-mongo.ts`,
  storeDriver("@zapo-js/store-mongo", "createMongoStore",
    "{ db: { uri: 'mongodb://127.0.0.1:27017', database: 'pkgstatus' } }"));
writeFileSync(`${DIR}/store-mysql.ts`,
  storeDriver("@zapo-js/store-mysql", "createMysqlStore",
    "{ pool: { host: '127.0.0.1', user: 'root', database: 'pkgstatus' } }"));
writeFileSync(`${DIR}/store-postgres.ts`,
  storeDriver("@zapo-js/store-postgres", "createPostgresStore",
    "{ pool: { host: '127.0.0.1', database: 'pkgstatus' } }"));
writeFileSync(`${DIR}/store-redis.ts`,
  storeDriver("@zapo-js/store-redis", "createRedisStore",
    "{ redis: { host: '127.0.0.1', port: 6379 } }"));

const MEM = [
  "WaAppStateMemoryStore", "WaAuthMemoryStore", "WaSignalMemoryStore", "WaPreKeyMemoryStore",
  "WaSessionMemoryStore", "WaIdentityMemoryStore", "SenderKeyMemoryStore", "WaRetryMemoryStore",
  "WaGroupMetadataMemoryStore", "WaChatMetadataMemoryStore", "WaDeviceListMemoryStore",
  "WaContactMemoryStore", "WaMessageSecretMemoryStore", "WaMessageMemoryStore",
  "WaThreadMemoryStore", "WaPrivacyTokenMemoryStore",
];
{
  const L = [];
  L.push("// pkgstatus lane-A driver for the objective's \"store-memory\".");
  L.push("// There is NO @zapo-js/store-memory package on npm. The in-memory store");
  L.push("// ships INSIDE zapo-js core (src/store/memory, published as dist/store/");
  L.push("// memory) and a consumer reaches it through the 'zapo-js/store' subpath.");
  L.push("// Every memory store class that subpath exports is CONSTRUCTED here.");
  L.push(`import {\n    ${MEM.join(",\n    ")}\n} from 'zapo-js/store'`);
  L.push("");
  for (const n of MEM) L.push(`console.log('${n}=' + typeof new ${n}())`);
  L.push("");
  writeFileSync(`${DIR}/store-memory.ts`, L.join("\n"));
}

writeFileSync(`${DIR}/media-utils.ts`, [
  "// pkgstatus lane-A driver, @zapo-js/media-utils.",
  "import { createMediaProcessor } from '@zapo-js/media-utils'",
  "",
  "const p = createMediaProcessor()",
  "console.log('processor=' + typeof p)",
  "console.log('generateImageThumbnail=' + typeof p.generateImageThumbnail)",
  "",
].join("\n"));

writeFileSync(`${DIR}/wam.ts`, [
  "// pkgstatus lane-A driver, @zapo-js/wam.",
  "import { wamPlugin, WaWamCoordinator } from '@zapo-js/wam'",
  "",
  "const p = wamPlugin()",
  "console.log('plugin=' + typeof p)",
  "console.log('coordinator=' + WaWamCoordinator.name)",
  "",
].join("\n"));

writeFileSync(`${DIR}/voip.ts`, [
  "// pkgstatus lane-A driver, @zapo-js/voip.",
  "import { voipPlugin, CallState, CallDirection, CallMediaType, EndCallReason } from '@zapo-js/voip'",
  "",
  "const p = voipPlugin()",
  "console.log('plugin=' + typeof p)",
  "console.log('state=' + CallState.Ringing)",
  "console.log('dir=' + CallDirection.Incoming)",
  "console.log('media=' + CallMediaType.Audio)",
  "console.log('end=' + EndCallReason.Timeout)",
  "",
].join("\n"));

console.log("wrote", readdirSync(DIR).join(" "));
