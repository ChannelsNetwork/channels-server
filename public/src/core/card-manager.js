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
    this._uploadedFileIds = [];
  }

  upload(file, filename) {
    return this._core.uploadFile(file, filename).then((result) => {
      this._uploadedFileIds.push(result.fileId);
      return result;
    });
  }

  uploadImage(file, filename) {
    return this._core.uploadImageFile(file, filename).then((result) => {
      this._uploadedFileIds.push(result.fileId);
      return result;
    });
  }

  get uploadedFileIds() {
    return this._uploadedFileIds;
  }

  clearUploadedFileIds() {
    this._uploadedFileIds = [];
  }

  discardUploadedFiles() {
    if (this._uploadedFileIds.length > 0) {
      return this._core.discardFiles(this._uploadedFileIds).then(() => {
        this._uploadedFileIds = [];
      });
    } else {
      return Promise.resolve();
    }
  }

  queryPage(url) {
    return this._core.queryPage(url);
  }
}

class UserManager {
  constructor(core) {
    this._core = core;
    this._handleInfos = {};
    this._userImages = {};
  }

  getHandleinfo(handle) {
    return new Promise((resolve, reject) => {
      if (this._handleInfos[handle]) {
        resolve(this._handleInfos[handle]);
      } else {
        $core.getHandleInfo(handle).then((info) => {
          if (info) {
            if (!info.image || !info.image.url) {
              info.image = { url: this.getFallbackUserImage(info.handle) };
            }
            this._handleInfos[handle] = info;
          }
          resolve(info);
        }).catch((err) => {
          reject(err);
        })
      }
    });
  }

  getFallbackUserImage(handle) {
    return "/s/images/avatars/av.png";
    // if (!this._userImages[handle]) {
    //   this._userImages[handle] = ("/s/images/avatars/av" + Math.round(Math.random()) + ".png");
    // }
    // return this._userImages[handle];
  }
}