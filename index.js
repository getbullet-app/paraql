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

    super()

    this._handle = null
    this._vfs = new ParaVFS(this, store, key, options)
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
        await binding.close(this._handle)
      } catch (err) {
        throw errors.from(err)
      }
    }

    await this._vfs.close()
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

  async addWriter(key) {
    await this._vfs.addWriter(key)
  }

  async removeWriter(key) {
    await this._vfs.removeWriter(key)
  }

  replicate(isInitiator) {
    return this._vfs.replicate(isInitiator)
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

    await this._vfs._exec(sql)
  }

  async prepare(sql) {
    if (!this.opened) await this.ready()

    const stmt = new ParaQLStatement(this, sql)

    await stmt.ready()

    return stmt
  }
}

function isObject(o) {
  return typeof o === "object" && o && !Buffer.isBuffer(o)
}
