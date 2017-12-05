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