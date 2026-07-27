const test = require("brittle")

const { INSERT, TABLE } = require("./helpers/constants")
const {
  BENCH_ROWS,
  create,
  dirSize,
  dump,
  formatTime,
  inserts,
  replicate,
  replicateAndSync,
  sync,
} = require("./helpers")

test.configure({
  // benchmark is only run manually, so allow for large timeout to get accurate results
  timeout: 3_600_000,
  // this isn't strictly a test, so no errors are expected or acceptable
  bail: true,
})

const WRITERS = 3
const RUNS = 3

test("single-writer exec", async (t) => {
  const [data] = await dump(1)
  const results = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t)

    await paraql.exec(TABLE)

    results.push(await t.execution(() => paraql.exec(data)))

    const usage = await dirSize(paraql._vfs.store.storage.path)

    t.comment(`Used ${usage} of storage space`)
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("single-writer prepare", async (t) => {
  const [data] = await inserts(1)
  const results = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t)

    await paraql.exec(TABLE)

    results.push(
      await t.execution(async () => {
        const stmt = await paraql.prepare(INSERT)

        stmt.batch(true)

        for (const row of data) {
          await stmt.run(...row)
        }

        await stmt.flush()
      }),
    )

    const usage = await dirSize(paraql._vfs.store.storage.path)

    t.comment(`Used ${usage} of storage space`)
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("multi-writer concurrent", async (t) => {
  const data = await inserts(WRITERS)
  const results = []

  for (let i = 0; i < RUNS; i++) {
    const paras = await create(WRITERS, t)

    t.teardown(replicate(...paras))

    await paras[0].exec(TABLE)
    await sync(...paras)

    results.push(
      await t.execution(async () => {
        for (let i = 0; i < paras.length; i++) {
          const stmt = await paras[i].prepare(INSERT)

          stmt.batch(true)

          for (const row of data[i]) {
            await stmt.run(...row)
          }

          await stmt.flush()
        }

        await sync(...paras)
      }),
    )

    for (let i = 0; i < paras.length; i++) {
      const usage = await dirSize(paras[i]._vfs.store.storage.path)

      t.comment(`Instance ${i} used ${usage} of storage space`)
    }
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Inserted ${BENCH_ROWS} rows from ${WRITERS} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("multi-writer sync", async (t) => {
  const data = await inserts(WRITERS)
  const results = []

  for (let i = 0; i < RUNS; i++) {
    const paras = await create(WRITERS, t)

    await paras[0].exec(TABLE)
    await replicateAndSync(...paras)

    for (let i = 0; i < paras.length; i++) {
      const stmt = await paras[i].prepare(INSERT)

      stmt.batch(true)

      for (const row of data[i]) {
        await stmt.run(...row)
      }

      await stmt.flush()
    }

    results.push(await t.execution(() => replicateAndSync(...paras)))

    for (let i = 0; i < paras.length; i++) {
      const usage = await dirSize(paras[i]._vfs.store.storage.path)

      t.comment(`Instance ${i} used ${usage} of storage space`)
    }
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Synced ${BENCH_ROWS} rows between ${WRITERS} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("multi-writer fast-forward", async (t) => {
  const data = await inserts(WRITERS)
  const results = []

  for (let i = 0; i < RUNS; i++) {
    const paras = await create(WRITERS + 1, t)
    const reader = paras.pop()
    const done = replicate(...paras)

    await paras[0].exec(TABLE)
    await sync(...paras)

    for (let i = 0; i < paras.length; i++) {
      const stmt = await paras[i].prepare(INSERT)

      stmt.batch(true)

      for (const row of data[i]) {
        await stmt.run(...row)
      }

      await stmt.flush()
    }

    await done()

    results.push(await t.execution(() => replicateAndSync(...paras, reader)))

    for (let i = 0; i < paras.length; i++) {
      const usage = await dirSize(paras[i]._vfs.store.storage.path)

      t.comment(`Instance ${i} used ${usage} of storage space`)
    }

    const usage = await dirSize(reader._vfs.store.storage.path)

    t.comment(`Instance ${paras.length} (reader) used ${usage} of storage space`)
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Synced ${BENCH_ROWS} rows from ${WRITERS} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})
