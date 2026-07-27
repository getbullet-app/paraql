const fs = require("bare-fs/promises")
const { create } = require("./helpers")

;(async () => {
  const [paraql] = await create(1)

  try {
    await paraql.close()

    try {
      await paraql.exec("SELECT 1")
    } catch (err) {
      console.log(err)
    }
  } finally {
    await fs.rm(paraql._vfs.store.storage.path, { recursive: true, force: true })
  }
})()
