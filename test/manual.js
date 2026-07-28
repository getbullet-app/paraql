const Corestore = require("corestore")
const fs = require("bare-fs/promises")
const tmp = require("test-tmp")

const ParaQL = require("..")
const { create, dirSize, inserts, replicateAndSync } = require("./helpers")
const { INSERT, TABLE } = require("./helpers/constants")

;(async () => {
  const n = 3
  const data = await inserts(n)
  const paras = await create(n)

  await paras[0].exec(TABLE)
  await replicateAndSync(...paras)

  for (let i = 0; i < paras.length; i++) {
    const stmt = await paras[i].prepare(INSERT)

    stmt.batch(true)

    for (const row of data[i]) {
      await stmt.run(...row)
    }

    await stmt.flush()
    await replicateAndSync(...paras)
  }

  for (let i = 0; i < paras.length; i++) {
    const beforeTotal = await dirSize(paras[i]._vfs.store.storage.path)
    const beforeTmp = await dirSize(`${paras[i]._vfs.store.storage.path}/paraql.db`)

    console.log(`Instance ${i} before compact ${beforeTotal} (${beforeTmp})`)

    await paras[i]._vfs.compact()

    const afterTotal = await dirSize(paras[i]._vfs.store.storage.path)
    const afterTmp = await dirSize(`${paras[i]._vfs.store.storage.path}/paraql.db`)

    console.log(`Instance ${i} after compact ${afterTotal} (${afterTmp})`)
  }

  for (const p of paras) {
    const input = data.flat(1)
    const select = await p.prepare("SELECT I, F1, F2 FROM pts1 ORDER BY I")
    const rows = await select.all()

    for (let i = 0; i < rows.length; i++) {
      if (
        input[i][0] !== rows[i].I
        || input[i][1] !== rows[i].F1
        || input[i][2] !== rows[i].F2
      ) {
        console.log(`FUCK ${i}`)
      }
    }
  }

  for (const p of paras) {
    await p.close()
  }
})()
