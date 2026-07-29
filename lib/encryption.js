const { Buffer } = require("buffer")
const c = require("compact-encoding")
const sodium = require("sodium-native")

const errors = require("./errors")

module.exports = class ParaQLEncryption {
  constructor(key, encryptionKey) {
    if (
      !Buffer.isBuffer(encryptionKey)
      || encryptionKey.byteLength !== sodium.crypto_stream_KEYBYTES
    ) {
      throw errors.INVALID_ARGUMENT("`encryptioKey` must be 32 byte buffer")
    }

    this._key = key
    this._encryptionKey = encryptionKey
  }

  _nonce(name, index) {
    const _name = Buffer.from(name)
    const _index = c.encode(c.uint64, index)
    const result = Buffer.alloc(sodium.crypto_stream_NONCEBYTES)

    sodium.crypto_generichash(result, Buffer.concat([this._key, _name, _index]))

    return result
  }

  encrypt(page, filename, index) {
    sodium.crypto_stream_xor(page, page, this._nonce(filename, index), this._encryptionKey)
    return page
  }

  decrypt(page, filename, index) {
    sodium.crypto_stream_xor(page, page, this._nonce(filename, index), this._encryptionKey)
    return page
  }
}
