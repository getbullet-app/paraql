const test = require("brittle")

const { INSERT, TABLE } = require("./helpers/constants")
const {
  BENCH_ROWS,
  create,
  dirSize,
  dump,
  formatSize,
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
  const before = []
  const compact = []
  const after = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t)

    await paraql.exec(TABLE)

    results.push(await t.execution(() => paraql.exec(data)))
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
  )
})

test("single-writer prepare", async (t) => {
  const [data] = await inserts(1)
  const results = []
  const before = []
  const compact = []
  const after = []

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
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
  )
})

test("single-writer encryption", async (t) => {
  const encryptionKey = Buffer.alloc(32, 13)
  const [data] = await inserts(1)
  const results = []
  const before = []
  const compact = []
  const after = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t, { encrypted: true, encryptionKey })

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
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
  )
})

test("single-writer compression", async (t) => {
  const [data] = await inserts(1)
  const results = []
  const before = []
  const compact = []
  const after = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t, { compressed: true })

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
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
  )
})

test("single-writer max compression", async (t) => {
  const [data] = await inserts(1)
  const results = []
  const before = []
  const compact = []
  const after = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t, { compressed: true, compressionLevel: 9 })

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
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
  )
})

test("single-writer compression + encryption", async (t) => {
  const encryptionKey = Buffer.alloc(32, 13)
  const [data] = await inserts(1)
  const results = []
  const before = []
  const compact = []
  const after = []

  for (let i = 0; i < RUNS; i++) {
    const [paraql] = await create(1, t, { encrypted: true, encryptionKey, compressed: true })

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
    before.push(await dirSize(paraql._vfs.store.storage.path))
    compact.push(await t.execution(() => paraql.compact()))
    after.push(await dirSize(paraql._vfs.store.storage.path))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)
  const compactAverage = Math.ceil(compact.reduce((i, s) => s + i, 0) / compact.length)
  const compactDeviation = Math.max(...compact) - Math.min(...compact)
  const beforeAverage = Math.ceil(before.reduce((i, s) => s + i, 0) / before.length)
  const afterAverage = Math.ceil(after.reduce((i, s) => s + i, 0) / after.length)

  t.comment(
    `Inserted ${BENCH_ROWS} rows in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
  t.comment(
    `Compacted in ~${formatTime(compactAverage)} (±${formatTime(compactDeviation)}) using ~${formatSize(afterAverage)} (~${formatSize(beforeAverage)} before compaction)`,
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
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Synced ${BENCH_ROWS} rows from ${WRITERS} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})
