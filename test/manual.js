const Corestore = require("corestore")
const fs = require("bare-fs/promises")
const tmp = require("test-tmp")

const ParaQL = require("..")
const { create, formatSize, inserts } = require("./helpers")
const { INSERT, TABLE } = require("./helpers/constants")

;(async () => {
  const [data] = await inserts(1)
  const [paraql] = await create(1)

  await paraql.exec(TABLE)

  const stmt = await paraql.prepare(INSERT)

  stmt.batch(true)

  for (const row of data) {
    await stmt.run(...row)
  }

  await stmt.flush()

  const info = await paraql.info()

  for (key in info) {
    info[key] = formatSize(info[key])
  }

  console.log(info)

  await paraql.close()
})()
