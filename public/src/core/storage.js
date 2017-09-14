class StorageService {
  getLocal(key, json) {
    if (window.localStorage) {
      let stored = window.localStorage.getItem(key) || null;
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

  setLocal(key, value) {
    if (window.localStorage) {
      if (typeof value === "string") {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.setItem(key, JSON.stringify(value));
      }
    }
  }
}