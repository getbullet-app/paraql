const test = require("brittle")
const {
  create,
  dirSize,
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

test("single-writer", async (t) => {
  const [data] = await inserts(1)
  const rows = data.split("\n").length
  const results = []

  {
    const [paraql] = await create(1, t)

    await paraql.exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )

    results.push(await t.execution(() => paraql.exec(data)))

    const usage = await dirSize(paraql._vfs.store.storage.path)

    t.comment(`Used ${usage} of storage space`)
  }
  {
    const [paraql] = await create(1, t)

    await paraql.exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )

    results.push(await t.execution(() => paraql.exec(data)))

    const usage = await dirSize(paraql._vfs.store.storage.path)

    t.comment(`Used ${usage} of storage space`)
  }
  {
    const [paraql] = await create(1, t)

    await paraql.exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )

    results.push(await t.execution(() => paraql.exec(data)))

    const usage = await dirSize(paraql._vfs.store.storage.path)

    t.comment(`Used ${usage} of storage space`)
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(`Inserted ${rows} rows in ~${formatTime(average)} (±${formatTime(deviation)})`)
})

test("multi-writer concurrent", async (t) => {
  const n = 3
  const data = await inserts(n)
  const rows = data.join("\n").split("\n").length
  const results = []

  {
    const paras = await create(n, t)

    t.teardown(replicate(...paras))

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    results.push(
      await t.execution(async () => {
        for (let i = 0; i < n; i++) {
          await paras[i].exec(data[i])
        }

        await sync(...paras)
      }),
    )
  }
  {
    const paras = await create(n, t)

    t.teardown(replicate(...paras))

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    results.push(
      await t.execution(async () => {
        for (let i = 0; i < n; i++) {
          await paras[i].exec(data[i])
        }

        await sync(...paras)
      }),
    )
  }
  {
    const paras = await create(n, t)

    t.teardown(replicate(...paras))

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    results.push(
      await t.execution(async () => {
        for (let i = 0; i < n; i++) {
          await paras[i].exec(data[i])
        }

        await sync(...paras)
      }),
    )
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Inserted ${rows} rows from ${n} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("multi-writer sync", async (t) => {
  const n = 3
  const data = await inserts(n)
  const rows = data.join("\n").split("\n").length
  const results = []

  {
    const paras = await create(n, t)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await replicateAndSync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    results.push(await t.execution(() => replicateAndSync(...paras)))
  }
  {
    const paras = await create(n, t)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await replicateAndSync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    results.push(await t.execution(() => replicateAndSync(...paras)))
  }
  {
    const paras = await create(n, t)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await replicateAndSync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    results.push(await t.execution(() => replicateAndSync(...paras)))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Synced ${rows} rows between ${n} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})

test("multi-writer fast-forward", async (t) => {
  const n = 3
  const data = await inserts(n)
  const rows = data.join("\n").split("\n").length
  const results = []

  {
    const paras = await create(n + 1, t)
    const reader = paras.pop()
    const done = replicate(...paras)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    await done()

    results.push(await t.execution(() => replicateAndSync(...paras, reader)))
  }
  {
    const paras = await create(n + 1, t)
    const reader = paras.pop()
    const done = replicate(...paras)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    await done()

    results.push(await t.execution(() => replicateAndSync(...paras, reader)))
  }
  {
    const paras = await create(n + 1, t)
    const reader = paras.pop()
    const done = replicate(...paras)

    await paras[0].exec(
      "CREATE TABLE pts1 ('I' SMALLINT NOT NULL, 'DT' TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 'F1' VARCHAR(4) NOT NULL, 'F2' VARCHAR(16) NOT NULL);",
    )
    await sync(...paras)

    for (let i = 0; i < n; i++) {
      await paras[i].exec(data[i])
    }

    await done()

    results.push(await t.execution(() => replicateAndSync(...paras, reader)))
  }

  const average = Math.ceil(results.reduce((i, s) => s + i, 0) / results.length)
  const deviation = Math.max(...results) - Math.min(...results)

  t.comment(
    `Synced ${rows} rows from ${n} writers in ~${formatTime(average)} (±${formatTime(deviation)})`,
  )
})
