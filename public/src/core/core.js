const _CKeys = {
  KEYS: "channels-identity",
  PROFILE: "channels-profile"
};

class CoreService extends Polymer.Element {
  static get is() { return "channels-core"; }

  constructor() {
    super();
    window.$core = this;
    this.restBase = document.getElementById('restBase').getAttribute('href') || "";
    this.storage = new StorageService();
    this.rest = new RestService();
    this._keys = this.storage.getLocal(_CKeys.KEYS, true);
    this._profile = null;
    if (this._keys && this._keys.privateKey) {
      this._profile = this.storage.getLocal(_CKeys.PROFILE, true);
    }
  }

  _loadKeyLib() {
    return new Promise((resolve, reject) => {
      if (this._keyLibLoaded) {
        resolve();
        return;
      }
      Polymer.importHref(this.resolveUrl("../../bower_components/channels-web-utils/channels-key-utils.html"), resolve, reject);
    });
  }

  _sign(data) {
    return $keyUtils.sign(data, this._keys.privateKeyPem);
  }

  _createRequest(details) {
    let json = JSON.stringify(details);
    let signature = this._sign(json);
    return {
      version: 1,
      details: json,
      signature: signature
    };
  }

  ensureKey() {
    return new Promise((resolve, reject) => {
      this._loadKeyLib().then(() => {
        if (this._keys && this._keys.privateKey) {
          resolve();
          return;
        }
        this._keys = $keyUtils.generateKey();
        this.storage.setLocal(_CKeys.KEYS, this._keys);
        resolve();
      }).catch((err) => {
        reject(err);
      });
    });
  }

  register(inviteCode) {
    return this.ensureKey().then(() => {
      if (this._registration) {
        return this._registration;
      }
      if (!this._keys) {
        throw "No private key found";
      }
      let details = RestUtils.registerUserDetails(this._keys.address, this._keys.publicKeyPem, inviteCode);
      let request = this._createRequest(details);
      const url = this.restBase + "/register-user";
      return this.rest.post(url, request).then((result) => {
        this._registration = result;
        this._fire("channels-registration", this._registration);
        this.getUserProfile();
        return result;
      });
    });
  }

  registerDevice(deviceCode) {
    return this.ensureKey().then(() => {
      let details = RestUtils.registerDeviceDetails(this._keys.address, deviceCode);
      let request = this._createRequest(details);
      const url = this.restBase + "/register-device";
      return this.rest.post(url, request);
    });
  }

  updateUserProfile(name, handle, location) {
    return this.ensureKey().then(() => {
      let details = RestUtils.updateIdentityDetails(this._keys.address, name, handle, location, null);
      let request = this._createRequest(details);
      const url = this.restBase + "/update-identity";
      return this.rest.post(url, request).then(() => {
        return this.getUserProfile();
      })
    });
  }

  getUserProfile() {
    return this.ensureKey().then(() => {
      let details = RestUtils.getUserIdentityDetails(this._keys.address);
      let request = this._createRequest(details);
      const url = this.restBase + "/get-identity";
      return this.rest.post(url, request).then((profile) => {
        this._profile = profile;
        this.storage.setLocal(_CKeys.PROFILE, profile);
        this._fire("channels-profile", this._profile);
        return profile;
      });
    });
  }

  checkHandle(handle) {
    return this._loadKeyLib().then(() => {
      let request;
      if (this.hasKey) {
        let details = RestUtils.checkHandleDetails(this._keys.address, handle);
        request = this._createRequest(details);
      } else {
        let details = RestUtils.checkHandleDetails(null, handle);
        request = {
          version: 1,
          details: JSON.stringify(details)
        };
      }
      const url = this.restBase + "/check-handle";
      return this.rest.post(url, request);
    });
  }

  get profile() {
    return this._profile;
  }

  get hasKey() {
    return (this._keys && this._keys.privateKey);
  }

  get registartion() {
    return this._registration;
  }

  _fire(name, detail) {
    let ce = new CustomEvent(name, { bubbles: true, composed: true, detail: (detail || {}) });
    window.dispatchEvent(ce);
  }

}
window.customElements.define(CoreService.is, CoreService);