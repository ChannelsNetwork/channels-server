const _CKeys = {
  KEYS: "channels-identity"
};

class CoreService extends Polymer.Element {
  static get is() { return "channels-core"; }

  constructor() {
    super();
    window.$core = this;
    this.storage = new StorageService();
    this.rest = new RestService();
    this._keys = this.storage.getLocal(_CKeys.KEYS, true);
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
      if (this._keys && this._keys.privateKey) {
        resolve();
        return;
      }
      this._loadKeyLib().then(() => {
        this._keys = $keyUtils.generateKey();
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
      return this.rest.post("", request).then((result) => {
        this._registration = result;
        return result;
      });
    });
  }

}
window.customElements.define(CoreService.is, CoreService);