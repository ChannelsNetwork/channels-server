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
}