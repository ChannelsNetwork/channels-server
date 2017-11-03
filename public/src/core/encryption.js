
class EncryptionUtils {
  static encryptString(value, password) {
    const vector = crypto.getRandomValues(new Uint8Array(16));
    const subtle = crypto.subtle || crypto.webkitSubtle;
    return subtle.digest({ name: "SHA-256" }, this._convertStringToArrayBufferView(password)).then((digest) => {
      return subtle.importKey("raw", digest, { name: "AES-CBC" }, false, ["encrypt"]).then((key) => {
        return subtle.encrypt({
          name: "AES-CBC",
          iv: vector
        },
          key,
          this._convertStringToArrayBufferView(value)
        ).then((encrypted) => {
          const buf = this._combineBuffers(vector, new Uint8Array(encrypted));
          return this.toHexString(buf);
        });
      });
    });
  }

  static decryptString(encryptedHex, password) {
    const combined = this.hexStringToByteArray(encryptedHex);
    const vector = combined.subarray(0, 16);
    const encrypted = combined.subarray(16);
    const subtle = crypto.subtle || crypto.webkitSubtle;
    return subtle.digest({ name: "SHA-256" }, this._convertStringToArrayBufferView(password)).then((digest) => {
      return subtle.importKey("raw", digest, { name: "AES-CBC" }, false, ["decrypt"]).then((key) => {
        return subtle.decrypt({
          name: "AES-CBC",
          iv: vector
        },
          key,
          encrypted
        ).then((decrypted) => {
          return this._convertArrayBufferViewtoString(new Uint8Array(decrypted));
        });
      });
    });
  }

  static toHexString(byteArray) {
    return Array.prototype.map.call(byteArray, function (byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('');
  }

  static hexStringToByteArray(hexString) {
    var result = [];
    while (hexString.length >= 2) {
      result.push(parseInt(hexString.substring(0, 2), 16));
      hexString = hexString.substring(2, hexString.length);
    }
    return Uint8Array.from(result);
  }

  static _combineBuffers(a, b) {
    const c = new Uint8Array(a.length + b.length);
    c.set(a);
    c.set(b, a.length);
    return c;
  }

  static _convertStringToArrayBufferView(str) {
    const bytes = new Uint8Array(str.length);
    for (var iii = 0; iii < str.length; iii++) {
      bytes[iii] = str.charCodeAt(iii);
    }
    return bytes;
  }

  static _convertArrayBufferViewtoString(buffer) {
    let str = "";
    for (var iii = 0; iii < buffer.byteLength; iii++) {
      str += String.fromCharCode(buffer[iii]);
    }
    return str;
  }
}
