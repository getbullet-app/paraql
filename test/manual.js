const fs = require("bare-fs/promises")
const { create, dirSize, formatTime } = require("./helpers")

;(async () => {
  const [paraql] = await create(1)
  const storage = paraql._vfs.store.storage.path
  const data = []

  for (let i = 0; i < 10_000; i++) {
    data.push(
      `INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES ('${i.toString().padStart(5, "0")}', CURRENT_TIMESTAMP, '6086', '6839549078383414');`,
    )
  }

  let start = Date.now()
  await paraql.exec(
    "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
  )
  console.log(`Created table in ${formatTime(Date.now() - start)}`)
  start = Date.now()
  await paraql.exec(data.join("\n"))
  console.log(`Inserted batch of 10_000 rows in ${formatTime(Date.now() - start)}`)

  const usage = await dirSize(storage)
  console.log(`Using ${usage} of disk space`)

  await paraql.close()
  await fs.rm(storage, { recursive: true, force: true })
})().then(async () => {
  const [paraql] = await create(1)
  const storage = paraql._vfs.store.storage.path

  let start = Date.now()
  await paraql.exec(
    "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
  )
  console.log(`Created table in ${formatTime(Date.now() - start)}`)

  start = Date.now()
  for (let i = 0; i < 10_000; i++) {
    await paraql.exec(
      `INSERT INTO 'pts1' ('I', 'DT', 'F1', 'F2') VALUES ('${i.toString().padStart(5, "0")}', CURRENT_TIMESTAMP, '6086', '6839549078383414');`,
    )
  }
  console.log(`Inserted 10_000 rows in ${formatTime(Date.now() - start)}`)

  const usage = await dirSize(storage)
  console.log(`Using ${usage} of disk space`)

  await paraql.close()
  await fs.rm(storage, { recursive: true, force: true })
})
