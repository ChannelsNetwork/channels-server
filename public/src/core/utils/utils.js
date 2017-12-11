class SocialService {
  tweet(text, url) {
    let windowOptions = "scrollbars=yes,resizable=yes,toolbar=no,location=yes";
    let width = 550;
    let height = 420;
    let winHeight = screen.height || window.innerHeight;
    let winWidth = screen.width || window.innerWidth;
    let left = Math.round((winWidth / 2) - (width / 2));
    let top = Math.round((winHeight / 2) - (height / 2));
    let href = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + "&via=channelscc&url=" + encodeURIComponent(url);
    window.open(href, '', windowOptions + ',width=' + width + ',height=' + height + ',left=' + left + ',top=' + top);
  }

  facebookShare(text, url) {
    return new Promise((resolve, reject) => {
      FB.ui({
        method: 'share',
        href: url
      }, (response) => {
        resolve(response);
      });
    });
  }
}

class CoreImageUtils {
  static resample(file, maxWidth, asBlob) {
    return new Promise((resolve, reject) => {
      const loadImage = window.loadImage;
      if (!loadImage) {
        reject("Failed to load image parse library");
        return;
      }
      loadImage.parseMetaData(file, (data) => {
        let orientation = 0;
        if (data.exif) {
          orientation = data.exif.get('Orientation');
        }
        let config = {
          canvas: true,
          orientation: orientation
        };
        if (maxWidth) {
          config.maxWidth = maxWidth;
        }
        loadImage(file, (canvas) => {
          let fileType = 'image/jpeg';
          if (file.type && file.type === 'image/png') {
            fileType = file.type;
          }
          if (asBlob) {
            canvas.toBlob((blob) => {
              resolve(blob);
            }, fileType);
          } else {
            var base64data = canvas.toDataURL(fileType);
            resolve(base64data);
          }
        }, config);
      });
    });
  }
}

class StorageService {
  getItem(key, json) {
    const result = this._getItemFromStorage(window.localStorage, key, json);
    if (result) {
      return result;
    }
    return this._getItemFromStorage(window.sessionStorage, key, json);
  }

  _getItemFromStorage(storage, key, json) {
    if (storage) {
      let stored = storage.getItem(key) || null;
      if (json) {
        if (stored) {
          return JSON.parse(stored);
        }
        return null;
      }
      return stored;
    } else {
      return null;
    }
  }

  setItem(key, value, trust) {
    this.clearItem(key);
    const storage = trust ? window.localStorage : window.sessionStorage;
    if (storage) {
      if (typeof value === "string") {
        storage.setItem(key, value);
      } else {
        storage.setItem(key, JSON.stringify(value));
      }
    }
  }

  clearItem(key) {
    if (window.localStorage) {
      window.localStorage.removeItem(key);
    }
    if (window.sessionStorage) {
      window.sessionStorage.removeItem(key);
    }
  }
}

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