const ReadyResource = require("ready-resource")

const binding = require("./binding")
const ParaVFS = require("./lib/vfs")

module.exports = exports = class ParaQL extends ReadyResource {
  constructor(store, key = null, options = {}) {
    if (isObject(key)) {
      options = key
      key = null
    }

    super()

    this._handle = binding.init()
    this._vfs = new ParaVFS(this, store, key, options)
  }

  async _open() {
    await this._vfs.ready()
    await binding.open(this._handle, this._vfs._handle, "paraql.db")
  }

  async _close() {
    if (this.opened) await binding.close(this._handle)
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

  async exec(query) {
    if (!this.opened) await this.ready()

    await this._vfs.exec(query)
  }

  async query(query) {
    if (!this.opened) await this.ready()

    return binding.exec(this._handle, query)
  }
}

function isObject(o) {
  return typeof o === "object" && o && !Buffer.isBuffer(o)
}
