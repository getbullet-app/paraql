const Buffer = require("bare-buffer")
const ReadyResource = require("ready-resource")

const binding = require("../binding")
const errors = require("./errors")

module.exports = class ParaQLStatement extends ReadyResource {
  constructor(db, sql) {
    super()

    this._db = db
    this._sourceSQL = sql
    this._handle = null
    this._queue = null
  }

  async _open() {
    try {
      this._handle = await binding.prepare(this._db._handle, this._sourceSQL)
    } catch (err) {
      throw errors.from(err)
    }
  }

  async _close() {
    if (this.opened) {
      try {
        await binding.finalize(this._handle)
        this._handle = null
        this._queue = null
        this._db._cache.delete(this._sourceSQL)
      } catch (err) {
        throw errors.from(err)
      }
    }
  }

  get sourceSQL() {
    return this._sourceSQL
  }

  get batching() {
    return !!this._queue
  }

  batch(on) {
    if (on === false) {
      this._queue = null
    } else {
      this._queue = this._queue ?? []
    }
  }

  async finalize() {
    await this.close()
  }

  async flush() {
    const queue = this._queue
    this._queue = []
    return this._db._vfs.flush(this._sourceSQL, queue)
  }

  async _bind(named, positional) {
    for (const key in named) {
      if (Array.isArray(named[key])) named[key] = JSON.stringify(named[key])
    }

    for (let i = 0; i < positional.length; i++) {
      if (Array.isArray(positional[i])) positional[i] = JSON.stringify(positional[i])
    }

    return binding.bind(this._handle, named, positional)
  }

  async all(...params) {
    if (this.closed) throw errors.ALREADY_CLOSED()

    const rows = []

    for await (const row of this.iterate(...params)) {
      rows.push(row)
    }

    return rows
  }

  async get(...params) {
    if (this.closed) throw errors.ALREADY_CLOSED()

    const [named, positional] = splitParameters(params)

    try {
      await this._bind(named, positional)
      const row = await binding.step(this._handle)
      return row === undefined ? undefined : wrapBlobRow(row)
    } catch (err) {
      throw errors.from(err)
    } finally {
      await binding.reset(this._handle)
    }
  }

  async _run(named, positional) {
    try {
      await this._bind(named, positional)
      return await binding.run(this._handle)
    } catch (err) {
      throw errors.from(err)
    } finally {
      await binding.reset(this._handle)
    }
  }

  async run(...params) {
    if (this.closed) throw errors.ALREADY_CLOSED()

    const [named, positional] = splitParameters(params)

    if (this._queue) {
      this._queue.push({ named, positional })
      return null
    } else {
      return this._db._vfs.run(this._sourceSQL, named, positional)
    }
  }

  async *iterate(...params) {
    if (this.closed) throw errors.ALREADY_CLOSED()

    const [named, positional] = splitParameters(params)

    try {
      await this._bind(named, positional)

      let row
      while ((row = await binding.step(this._handle)) !== undefined) {
        yield wrapBlobRow(row)
      }
    } catch (err) {
      throw errors.from(err)
    } finally {
      await binding.reset(this._handle)
    }
  }
}

function wrapBlobRow(row) {
  for (const key in row) {
    if (row[key] instanceof ArrayBuffer) row[key] = Buffer.from(row[key])
  }
  return row
}

function splitParameters(params) {
  if (params.length === 0) return [null, params]
  if (!isNamedParameters(params[0])) return [null, params]
  return [params[0], params.slice(1)]
}

function isNamedParameters(value) {
  if (value === null) return false
  if (typeof value !== "object") return false
  if (Array.isArray(value)) return false
  if (ArrayBuffer.isView(value)) return false
  if (value instanceof ArrayBuffer) return false
  return true
}
