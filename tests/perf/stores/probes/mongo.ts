import { MongoClient } from "mongodb"

async function main(): Promise<void> {
  const c = new MongoClient("mongodb://127.0.0.1:64715/?directConnection=true")
  await c.connect()
  const col = c.db("zapo_test").collection("probe")
  await col.updateOne({ k: "probe:key" }, { $set: { v: "probe-value" } }, { upsert: true })
  const doc = await col.findOne({ k: "probe:key" })
  console.log("mongo got: " + (doc as unknown as { v: string }).v)
  await c.close()
}
main()
