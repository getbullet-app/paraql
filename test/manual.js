const fs = require("bare-fs/promises")
const { create } = require("./helpers")

const TABLE =
  "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' VARCHAR(4) NOT NULL, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);"
const INSERT = "INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES (?, 'ABCD', ?, ?);"

;(async () => {
  const [paraql] = await create(1)

  try {
    try {
      await paraql.exec(`
        CREATE TABLE t (id INTEGER);
        INSERT INTO nonexistent VALUES (1);
      `)
    } catch (err) {
      console.log(err)
    }

    const select = await paraql.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='t'",
    )
    const row = await select.get()
    console.log(row)
  } finally {
    await paraql.close()
    await fs.rm(paraql._vfs.store.storage.path, { recursive: true, force: true })
  }
})()
