const test = require("brittle")
const { create } = require("./helpers")

test("basic vector search - cosine similarity", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")

  const insert = await paraql.prepare("INSERT INTO embeddings VALUES (vector(?));")

  await insert.run([1, 2, 3, 4])
  await insert.run([2, 3, 4, 5])
  await insert.run([3, 4, 5, 6])
  await insert.run([4, 5, 6, 7])

  const select = await paraql.prepare(
    "SELECT rowid, vector_distance_cos(v, vector(?)) AS distance FROM embeddings ORDER BY distance ASC;",
  )

  const result = await select.all([3, 4, 5, 6])

  t.alike(
    result.map((r) => r.rowid),
    [3, 4, 2, 1],
  )
})

test("basic vector search - euclidean distance", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")

  const insert = await paraql.prepare("INSERT INTO embeddings VALUES (vector(?));")

  await insert.run([1, 2, 3, 4])
  await insert.run([2, 3, 4, 5])
  await insert.run([3, 4, 5, 6])
  await insert.run([4, 5, 6, 7])

  const select = await paraql.prepare(
    "SELECT rowid, vector_distance_l2(v, vector(?)) AS distance FROM embeddings ORDER BY distance ASC;",
  )

  const result = await select.all([3, 4, 5, 6])

  t.alike(
    result.map((r) => r.rowid),
    [3, 2, 4, 1],
  )
})

test("basic vector search - indexed", async (t) => {
  const [paraql] = await create(1, t)

  await paraql.exec("CREATE TABLE embeddings (v FLOAT32(4));")
  await paraql.exec("CREATE INDEX embeddings_idx ON embeddings( libsql_vector_idx(v) );")

  const insert = await paraql.prepare("INSERT INTO embeddings VALUES (vector(?));")

  await insert.run([1, 2, 3, 4])
  await insert.run([2, 3, 4, 5])
  await insert.run([3, 4, 5, 6])
  await insert.run([4, 5, 6, 7])

  const select = await paraql.prepare(
    "SELECT rowid FROM vector_top_k('embeddings_idx', vector(?), 4);",
  )

  const result = await select.all([3, 4, 5, 6])

  t.alike(
    result.map((r) => r.rowid),
    [3, 4, 2, 1],
  )
})
