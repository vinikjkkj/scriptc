import Redis from "ioredis"

async function main(): Promise<void> {
  const r = new Redis({ host: "127.0.0.1", port: 64712 })
  await r.set("probe:key", "probe-value")
  const v = await r.get("probe:key")
  console.log(`redis got: ${v}`)
  await r.quit()
}
main()
