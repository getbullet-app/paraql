const fs = require("bare-fs/promises")
const { create, dirSize, formatTime } = require("./helpers")

;(async () => {
  const [paraql] = await create(1)
  const storage = paraql._vfs.store.storage.path
  const data = []

  await paraql.exec(
    "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
  )

  const insert = await paraql.prepare(
    "INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES (?, CURRENT_TIMESTAMP, ?, ?);",
  )
  console.log("STMT", insert._handle)

  console.log(await insert.run(1, "9399", "8989662025153288"))

  await insert.finalize()

  const select = await paraql.prepare("SELECT * FROM 'pts1';")

  console.log("ALL", await select.all())

  console.log("GET", await select.get())

  for await (const row of select.iterate()) {
    console.log("ITERATE", row)
  }

  await select.finalize()

  const usage = await dirSize(storage)
  console.log(`Using ${usage} of disk space`)

  await paraql.close()
  await fs.rm(storage, { recursive: true, force: true })
})()
