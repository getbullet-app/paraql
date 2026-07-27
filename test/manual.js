const fs = require("bare-fs/promises")
const { create } = require("./helpers")

;(async () => {
  const [paraql] = await create(1)

  try {
    const stmt = await paraql.prepare("SELECT 1")

    await paraql.close()

    try {
      const r = await stmt.get()
      console.log(r)
    } catch (err) {
      console.log(err)
    }
  } finally {
    await fs.rm(paraql._vfs.store.storage.path, { recursive: true, force: true })
  }
})()
