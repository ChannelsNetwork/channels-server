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