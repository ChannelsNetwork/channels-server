class CardManager {
  constructor(core) {
    this._core = core;
    this._packages = {};
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

  upload(file) {
    return this._core.uploadFile(file);
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
            if (!info.imageUrl) {
              info.imageUrl = this.getFallbackUserImage(info.handle);
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
    if (!this._userImages[handle]) {
      this._userImages[handle] = ("/s/images/avatars/av" + Math.round(Math.random()) + ".png");
    }
    return this._userImages[handle];
  }
}