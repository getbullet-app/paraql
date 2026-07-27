const fs = require("bare-fs/promises")
const { create } = require("./helpers")

;(async () => {
  const [paraql] = await create(1)

  try {
    await paraql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")

    const insert = await paraql.prepare("INSERT INTO t (name) VALUES (?)")

    insert.batch(true)

    for (let i = 0; i < 5; i++) {
      console.log(await insert.run(`row-${i}`))
    }

    console.log(await insert.flush())

    const select = await paraql.prepare("SELECT name FROM t ORDER BY id")
    const rows = await select.all()

    console.log(rows)
  } finally {
    await paraql.close()
    await fs.rm(paraql._vfs.store.storage.path, { recursive: true, force: true })
  }
})()
