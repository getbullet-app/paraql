const Corestore = require("corestore")
const fs = require("fs/promises")
const tmp = require("test-tmp")

const ParaQL = require("..")
const { create, formatSize, inserts } = require("./helpers")
const { INSERT, TABLE } = require("./helpers/constants")

;(async () => {
  const [data] = await inserts(1)
  const [paraql] = await create(1, null, { compressed: true })

  await paraql.exec(TABLE)

  const insert = await paraql.prepare(INSERT)

  insert.batch(true)

  for (const row of data) {
    await insert.run(...row)
  }

  console.log(await insert.flush())

  const info = await paraql.info()

  for (key in info) {
    info[key] = formatSize(info[key])
  }

  console.log(info)

  const select = await paraql.prepare("SELECT I, F1, F2 FROM pts1 ORDER BY I")
  const rows = await select.all()

  for (let i = 0; i < data.length; i++) {
    if (rows[i].I !== data[i][0] || rows[i].F1 !== data[i][1] || rows[i].F2 !== data[i][2]) {
      console.log(`FUCK ${i}`)
    }
  }

  await paraql.close()
})()
