const Buffer = require("bare-buffer")
const Corestore = require("corestore")
const fs = require("bare-fs/promises")
const path = require("bare-path")
const tmp = require("test-tmp")

const { BENCH_ROWS } = require("./constants")
const ParaQL = require("../..")

async function dump(n) {
  const data = await fs.readFile(
    path.resolve(__dirname, "../fixtures/sqlite-2500-insertions.txt"),
    "utf-8",
  )
  const rows = data.split("\n")
  const chunkSize = Math.ceil(rows.length / n)
  const chunks = []

  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize).join("\n"))
  }

  return chunks
}

async function inserts(n) {
  const rows = []

  for (let i = 0; i < BENCH_ROWS; i++) {
    rows.push([i, unistr(4), unistr(16)])
  }

  const chunkSize = Math.ceil(BENCH_ROWS / n)
  const chunks = []

  for (let i = 0; i < BENCH_ROWS; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize))
  }

  return chunks
}

function random(n) {
  return Math.floor(Math.random() * n)
}

function unistr(n) {
  const length = Math.ceil(n / 2)
  const buffer = []

  for (let i = 0; i < length; i++) {
    buffer.push(random(256))
  }

  return Buffer.from(buffer).toString("hex").slice(0, n)
}

async function create(n, t, options = {}) {
  if (t && !t.teardown && !t.tmp) {
    options = t
    t = null
  }

  const store = new Corestore(await tmp(t))
  const paras = [new ParaQL(store, options)]

  await paras[0].ready()

  for (let i = 1; i < n; i++) {
    const store = new Corestore(await tmp(t))
    paras.push(new ParaQL(store, paras[0].key, options))

    await paras[i].ready()
    await paras[0].addWriter(paras[i].local)
  }

  t?.teardown(async () => {
    for (const p of paras) await p.close()
  })

  return [...paras]
}

function replicate(...paras) {
  const teardowns = []

  while (paras.length > 1) {
    const a = paras.pop()

    for (let i = 0; i < paras.length; i++) {
      const b = paras[i]

      const s1 = a.replicate(true)
      const s2 = b.replicate(false)

      s1.pipe(s2).pipe(s1)

      teardowns.push(async () => {
        s1.destroy()
        s2.destroy()

        await Promise.all([
          new Promise((resolve) => s1.once("close", resolve)),
          new Promise((resolve) => s2.once("close", resolve)),
        ])
      })
    }
  }

  return async () => {
    for (const teardown of teardowns) await teardown()
  }
}

async function sync(...paras) {
  const scale = [10, 10, 20, 30, 40, 50]

  while (true) {
    if (await check()) {
      for (const p of paras) await p._vfs.bee.flush()

      if (await check()) {
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, scale.shift() || 100))
  }

  async function check() {
    for (const a of paras) {
      await a._vfs.bee.updated()

      for (const b of paras) {
        if (a === b) continue

        await b._vfs.bee.updated()

        const info = await b._vfs.bee.system.get(a.local)
        const length = info ? info.length : 0

        if (length !== a._vfs.bee.local.length) {
          return false
        }
      }
    }

    return true
  }
}

async function replicateAndSync(...paras) {
  const done = replicate(...paras)
  await sync(...paras)
  await done()
}

async function dirSize(dir) {
  let bytes = 0

  for (const file of await fs.readdir(dir, { recursive: true })) {
    try {
      const stat = await fs.stat(path.resolve(dir, file))

      bytes += stat.size
    } catch (err) {
      console.error(`Error reading ${path.join(dir, file)}: ${err.message}`)
    }
  }

  return bytes
}

function formatSize(bytes) {
  const unit = 1024

  const exp = Math.floor(Math.log(bytes) / Math.log(unit))
  const pre = " " + "kMGTPE".charAt(exp - 1) + "B"

  if (bytes < unit) return bytes + " B"

  return (bytes / Math.pow(unit, exp)).toFixed(1) + pre
}

function formatTime(timestamp) {
  const second = 1_000
  const minute = 60 * second
  const hour = 60 * minute
  const hours = Math.floor(timestamp / hour)
  const minutes = Math.floor((timestamp % hour) / minute)
  const seconds = Math.floor((timestamp % minute) / second)
  const milis = timestamp % second
  let output = `${milis.toString(10).padStart(3, "0")}ms`

  if (seconds || minutes || hours) {
    output = `${seconds.toString(10).padStart(2, "0")}s:${output}`
  }

  if (minutes || hours) {
    output = `${minutes.toString(10).padStart(2, "0")}m:${output}`
  }

  if (hours) {
    output = `${hours.toString(10).padStart(2, "0")}h:${output}`
  }

  return output
}

module.exports = {
  BENCH_ROWS,
  create,
  dirSize,
  dump,
  formatSize,
  formatTime,
  inserts,
  random,
  replicate,
  replicateAndSync,
  sync,
  unistr,
}
