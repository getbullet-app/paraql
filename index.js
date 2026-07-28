const Buffer = require("bare-buffer")
const ReadyResource = require("ready-resource")

const binding = require("./binding")
const errors = require("./lib/errors")
const ParaQLStatement = require("./lib/statement")
const ParaVFS = require("./lib/vfs")

module.exports = exports = class ParaQL extends ReadyResource {
  constructor(store, key = null, options = {}) {
    if (isObject(key)) {
      options = key
      key = null
    }

    const { cacheSize = 1024, ...opts } = options

    super()

    this._handle = null
    this._vfs = new ParaVFS(this, store, key, opts)
    this._cacheSize = cacheSize
    this._cache = new Map()
  }

  get name() {
    return this._vfs.name
  }

  get key() {
    return this._vfs.key
  }

  get local() {
    return this._vfs.local
  }

  get discoveryKey() {
    return this._vfs.discoveryKey
  }

  get writable() {
    return this._vfs.writable
  }

  async _open() {
    await this._vfs.ready()

    try {
      this._handle = await binding.open("paraql.db")
    } catch (err) {
      throw errors.from(err)
    }
  }

  async _close() {
    if (this.opened) {
      try {
        for (const stmt of this._cache.values()) {
          await stmt.finalize()
        }

        this._cache.clear()
        await binding.close(this._handle)
      } catch (err) {
        throw errors.from(err)
      }
    }

    await this._vfs.close()
  }

  async addWriter(key) {
    await this._vfs.addWriter(key)
  }

  async removeWriter(key) {
    await this._vfs.removeWriter(key)
  }

  replicate(isInitiator) {
    return this._vfs.replicate(isInitiator)
  }

  async compact() {
    return this._vfs.compact()
  }

  async _exec(sql) {
    try {
      await binding.exec(this._handle, sql)
    } catch (err) {
      throw errors.from(err)
    }
  }

  async exec(sql) {
    if (!this.opened) await this.ready()

    if (this.closed) throw errors.ALREADY_CLOSED()

    await this._vfs.exec(sql)
  }

  async prepare(sql) {
    if (!this.opened) await this.ready()

    if (this.closed) throw errors.ALREADY_CLOSED()

    let stmt = this._cache.get(sql)

    if (stmt) {
      this._cache.delete(sql)
      this._cache.set(sql, stmt)
      return stmt
    }

    stmt = new ParaQLStatement(this, sql)

    await stmt.ready()

    this._cache.set(sql, stmt)

    if (this._cache.size > this._cacheSize) {
      const oldest = this._cache.values().next().value

      await oldest.finalize()
    }

    return stmt
  }
}

function isObject(o) {
  return typeof o === "object" && o && !Buffer.isBuffer(o)
}
