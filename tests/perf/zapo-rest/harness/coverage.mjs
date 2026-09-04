// Cross-reference zapo's public surface against the routes zapo-rest serves.
import { readFileSync, writeFileSync } from "node:fs";

const surface = readFileSync("G:/blocks/restapi/lab/surface.txt", "utf8");
const routes = new Set(
  readFileSync("G:/blocks/restapi/lab/routes.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean),
);

// group name -> route prefix
const prefixOf = {
  client: "",
  auth: "/auth",
  message: "/message",
  presence: "/presence",
  lowlevel: "/lowlevel",
  chat: "/chat",
  group: "/group",
  status: "/status",
  broadcastList: "/broadcastList",
  newsletter: "/newsletter",
  privacy: "/privacy",
  profile: "/profile",
  business: "/business",
  bot: "/bot",
  email: "/email",
  mobile: "/mobile",
};

// Reasons for members that are deliberately not routed.
const EMITTER = "EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead";
const INTERNAL = "internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation";
const CALLBACK = "takes a callback and returns an unsubscribe function — cannot cross an HTTP boundary; use GET /events";
const STREAM = "returns a Node Readable the caller must own; use the bytes form instead";
const HUGE = "argument is the 60-arm app-state schema union; no stable JSON spelling — use the named per-collection routes";
const SENSITIVE = "returns private key material; deliberately not exposed over HTTP (GET /credentials reports presence only)";
const RESULTOBJ = "takes a WaAppStateSyncResult value returned by another call in the same process; not addressable over HTTP";
const MEDIAUP = "takes an upload handle / media source object rather than a scalar; use the media routes";

const reasons = {
  "client.on": EMITTER, "client.once": EMITTER, "client.off": EMITTER, "client.emit": EMITTER,
  "client.addListener": EMITTER, "client.removeListener": EMITTER, "client.removeAllListeners": EMITTER,
  "client.setMaxListeners": EMITTER, "client.getMaxListeners": EMITTER, "client.listeners": EMITTER,
  "client.rawListeners": EMITTER, "client.listenerCount": EMITTER, "client.prependListener": EMITTER,
  "client.prependOnceListener": EMITTER, "client.eventNames": EMITTER,
  "client.ignoreKey": CALLBACK,
  "auth.getCurrentCredentials": SENSITIVE,
  "auth.buildCommsConfig": INTERNAL, "auth.persistServerStaticKey": INTERNAL,
  "auth.persistServerHasPreKeys": INTERNAL, "auth.persistRoutingInfo": INTERNAL,
  "auth.clearRoutingInfo": INTERNAL, "auth.persistSuccessAttributes": INTERNAL,
  "auth.handleIncomingIqSet": INTERNAL, "auth.handleLinkCodeNotification": INTERNAL,
  "auth.handleCompanionRegRefreshNotification": INTERNAL,
  "message.download": STREAM,
  "message.upload": MEDIAUP,
  "message.tryDecryptAddon": INTERNAL,
  "bot.tryDecryptChunk": INTERNAL,
  "lowlevel.registerIncomingHandler": CALLBACK,
  "lowlevel.unregisterIncomingHandler": CALLBACK,
  "lowlevel.registerIncomingStanzaFilter": CALLBACK,
  "chat.set": HUGE, "chat.remove": HUGE,
  "chat.getBlockedCollections": RESULTOBJ, "chat.emitEventsFromSyncResult": RESULTOBJ,
  "business.updateCoverPhoto": MEDIAUP,
  "profile.setProfilePicture": MEDIAUP,
  "mobile.sendHistorySyncBootstrap": INTERNAL,
};

const groups = [];
let cur = null;
for (const line of surface.split("\n")) {
  const h = /^## (\S+)\s+—\s+(\S+)\s+\((\d+)\)/.exec(line);
  if (h) {
    cur = { name: h[1], type: h[2], members: [] };
    groups.push(cur);
    continue;
  }
  if (!cur) continue;
  const m = /^  ([a-zA-Z_$][\w$]*)[(<:]/.exec(line);
  if (m) cur.members.push({ name: m[1], sig: line.trim() });
}

let impl = 0, unimpl = 0;
const rows = [];
const unimplemented = [];
for (const g of groups) {
  const short = g.name === "client" ? "client" : g.name.slice("client.".length);
  const prefix = prefixOf[short];
  for (const mem of g.members) {
    const key = short === "client" ? `client.${mem.name}` : `${short}.${mem.name}`;
    const candidate = short === "client" ? `/${mem.name}` : `${prefix}/${mem.name}`;
    let routed = routes.has(candidate);
    // client-level aliases that were given friendlier paths
    if (!routed && short === "client") {
      const alias = { getState: "/state", getCredentials: "/credentials", getClockSkewMs: "/clockSkewMs",
                      connect: "/connect", disconnect: "/disconnect", logout: "/logout" }[mem.name];
      if (alias && routes.has(alias)) routed = true;
    }
    if (routed) { impl++; rows.push({ key, route: candidate, sig: mem.sig }); }
    else {
      unimpl++;
      unimplemented.push({ key, reason: reasons[key] ?? "NOT YET ROUTED", sig: mem.sig });
    }
  }
}

console.log(`surface members: ${impl + unimpl}`);
console.log(`  routed:       ${impl}`);
console.log(`  not routed:   ${unimpl}`);
const noReason = unimplemented.filter((u) => u.reason === "NOT YET ROUTED");
console.log(`  of which with NO stated reason: ${noReason.length}`);
for (const u of noReason) console.log(`     ${u.key}`);
writeFileSync("G:/blocks/restapi/lab/coverage.json", JSON.stringify({ impl, unimpl, rows, unimplemented }, null, 1));
