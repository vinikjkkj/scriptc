// The zapo-js core, reached the way an application reaches it: a WaClient over a MySQL-backed store, then the public
// messaging, media, group and connection API. Written from the zapo-js README and its published type declarations (zapo.to),
// not from any application. Compile-only: nothing here connects (the pool never opens a socket).
import { ConsoleLogger, WaClient, WaMediaTransferClient, createStore, downloadMediaMessage } from "zapo-js";
import type { WaIncomingMessageEvent } from "zapo-js";
import { createMysqlPool, createMysqlStore } from "@zapo-js/store-mysql";

async function main(): Promise<void> {
  const pool = createMysqlPool({
    host: "127.0.0.1",
    port: 3306,
    user: "u",
    password: "p",
    database: "d",
    connectionLimit: 2,
    waitForConnections: true,
  });
  const mysql = createMysqlStore({ pool, tablePrefix: "t_" });
  const store = createStore({
    backends: { mysql },
    providers: {
      auth: "mysql",
      signal: "mysql",
      preKey: "mysql",
      session: "mysql",
      identity: "mysql",
      senderKey: "mysql",
      appState: "mysql",
      privacyToken: "mysql",
      messages: "mysql",
      threads: "mysql",
      contacts: "mysql",
    },
  });

  const client = new WaClient({ store, sessionId: "default" }, new ConsoleLogger("info"));

  client.on("auth_qr", ({ qr }) => {
    console.log("scan this:", qr);
  });
  client.on("auth_paired", ({ credentials }) => {
    console.log("paired as", credentials.meJid);
  });
  client.on("message", async (event: WaIncomingMessageEvent) => {
    if (event.message?.conversation === "ping") {
      // a direct chat (a Signal session) and a group chat (a sender key) both go through the message coordinator
      await client.message.send(event.key.remoteJid!, "pong");
      await client.message.send("120363000000000000@g.us", { type: "text", text: "pong" });
    }
    const stream = await downloadMediaMessage(event);
    stream.resume();
    const viaClient = await client.message.download(event);
    viaClient.resume();
  });

  // media: upload through the message coordinator, then send the result as an image
  const uploaded = await client.message.upload(new Uint8Array([1, 2, 3]), { type: "image", mimetype: "image/png" });
  console.log(Object.keys(uploaded).length);
  const transfer = WaMediaTransferClient;
  console.log(typeof transfer);

  await client.group.createGroup("rig", ["5511999999999@s.whatsapp.net"]);
  await client.connect();
  await client.disconnect();
  await mysql.destroy();
}
main().catch((e) => console.log("failed", (e as Error).message));
