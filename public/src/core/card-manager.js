class CardManager {
  constructor(core) {
    this._core = core;
    this._packages = {};
    this._cardCache = {};
  }

  ensurePackage(packageName) {
    return new Promise((resolve, reject) => {
      if (this._packages[packageName]) {
        resolve(this._packages[packageName]);
      } else {
        this._core.ensureComponent(packageName).then((data) => {
          this._packages[packageName] = data;
          resolve(data);
        }).catch((err) => {
          reject(err);
        });
      }
    });
  }

  cacheCardData(id, name, value) {
    if ((!id) || (!name)) {
      return;
    }
    if (!this._cardCache[id]) {
      this._cardCache[id] = {};
    }
    this._cardCache[id][name] = value;
  }

  getCachedCardData(id, name) {
    if (this._cardCache[id]) {
      return this._cardCache[id][name || ""];
    }
    return null;
  }

  removeCachedCardData(id, name) {
    if (this._cardCache[id]) {
      name = name || "";
      if (this._cardCache[id][name]) {
        delete this._cardCache[id][name];
      }
    }
  }

  get cardService() {
    if (!this._cardService) {
      this._cardService = new CardService(this._core);
    }
    return this._cardService;
  }
}

class CardService {
  constructor(core) {
    this._core = core;
  }

  upload(file, filename) {
    return this._core.uploadFile(file, filename);
  }

  uploadImage(file, filename) {
    return this._core.uploadImageFile(file, filename);
  }
}