const _CKeys = {
  KEYS: "channels-identity",
  PROFILE: "channels-profile",
  AGREED_TERMS: "channels-terms-agreed"
};

class CoreService extends Polymer.Element {
  static get is() { return "channels-core"; }

  constructor() {
    super();
    window.$core = this;
    this.restBase = document.getElementById('restBase').getAttribute('href') || "";
    this.publicBase = document.getElementById('publicBase').getAttribute("href") || "";
    this.storage = new StorageService();
    this.rest = new RestService();
    this.dummy = new DummyService(this);
    this._keys = this.storage.getLocal(_CKeys.KEYS, true);
    this._profile = null;
    if (this._keys && this._keys.privateKey) {
      this._profile = this.storage.getLocal(_CKeys.PROFILE, true);
    }
  }

  agreeToTnCs() {
    this.storage.setLocal(_CKeys.AGREED_TERMS, true);
  }

  isAgreedToTnCs() {
    return this.storage.getLocal(_CKeys.AGREED_TERMS) ? true : false;
  }

  hasKeys() {
    return this._keys && this._keys.privateKey ? true : false;
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
        this._lastRegistrationAt = Date.now();
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

  updateUserProfile(name, handle, location, imageUrl, email) {
    return this.ensureKey().then(() => {
      let details = RestUtils.updateIdentityDetails(this._keys.address, name, handle, location, imageUrl, email);
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

  getSyncCode() {
    return this.ensureKey().then(() => {
      let details = RestUtils.getSyncCodeDetails(this._keys.address);
      let request = this._createRequest(details);
      const url = this.restBase + "/get-sync-code";
      return this.rest.post(url, request);
    });
  }

  syncIdentity(handle, syncCode) {
    return this.ensureKey().then(() => {
      let details = RestUtils.syncIdentityDetails(this._keys.address, handle, syncCode);
      let request = this._createRequest(details);
      const url = this.restBase + "/sync-identity";
      return this.rest.post(url, request);
    });
  }

  getFeeds(maxCardsPerFeed) {
    return this.ensureKey().then(() => {
      let details = RestUtils.getFeedDetails(this._keys.address, maxCardsPerFeed);
      let request = this._createRequest(details);
      const url = this.restBase + "/get-feed";
      return this.rest.post(url, request);
    });
  }

  getFeed(type, maxCards) {  // type = "recommended" | "new" | "mine" | "opened"
    return this.ensureKey().then(() => {
      let details = RestUtils.getFeedDetails(this._keys.address, maxCards, type);
      let request = this._createRequest(details);
      const url = this.restBase + "/get-feed";
      return this.rest.post(url, request);
    });
  }

  ensureComponent(packageName) {
    return this.ensureKey().then(() => {
      let details = RestUtils.ensureComponentDetails(this._keys.address, packageName);
      let request = this._createRequest(details);
      const url = this.restBase + "/ensure-component";
      return this.rest.post(url, request);
    });
  }

  postCard(imageUrl, linkUrl, title, text, packageName, packageIconUrl, promotionFee, openPayment, openFeeUnits, initialState) {
    return this.ensureKey().then(() => {
      let details = RestUtils.postCardDetails(this._keys.address, imageUrl, linkUrl, title, text, packageName, packageIconUrl, promotionFee, openPayment, openFeeUnits, initialState);
      let request = this._createRequest(details);
      const url = this.restBase + "/post-card";
      return this.rest.post(url, request);
    });
  }

  cardImpression(cardId) {
    return this.ensureKey().then(() => {
      let details = RestUtils.cardImpressionDetails(this._keys.address, cardId);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-impression";
      return this.rest.post(url, request);
    });
  }

  cardOpened(cardId) {
    return this.ensureKey().then(() => {
      let details = RestUtils.cardOpenedDetails(this._keys.address, cardId);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-opened";
      return this.rest.post(url, request);
    });
  }

  cardPay(cardId, amount, authorAddress, cardDeveloperAddress, cardDeveloperFraction, networkAddress, royaltyAddress, referrerAddress) {
    return this.ensureKey().then(() => {
      const recipients = [];
      recipients.push(RestUtils.bankTransactionRecipient(authorAddress, "remainder"));
      if (cardDeveloperAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(cardDeveloperAddress, "fraction", cardDeveloperFraction));
      }
      if (networkAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(networkAddress, "fraction", 0.03));
      }
      if (royaltyAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(royaltyAddress, "fraction", 0.05));
      }
      if (referrerAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(referrerAddress, "fraction", 0.02));
      }
      const transaction = RestUtils.bankTransaction(this._keys.address, "transfer", "card-open", cardId, null, amount, recipients);
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      let details = RestUtils.cardPayDetails(this._keys.address, cardId, transactionString, transactionSignature);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-opened";
      return this.rest.post(url, request);
    });
  }

  cardClosed(cardId) {
    return this.ensureKey().then(() => {
      let details = RestUtils.cardClosedDetails(this._keys.address, cardId);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-closed";
      return this.rest.post(url, request);
    });
  }

  updateCardLike(cardId, selection) {  // "like" | "none" | "dislike"
    return this.ensureKey().then(() => {
      let details = RestUtils.updateCardLikeDetails(this._keys.address, cardId, selection);
      let request = this._createRequest(details);
      const url = this.restBase + "/update-card-like";
      return this.rest.post(url, request);
    });
  }

  get profile() {
    return this._profile;
  }

  get hasKey() {
    return (this._keys && this._keys.privateKey);
  }

  get registration() {
    return this._registration;
  }

  get balance() {
    if (!this._registration) {
      return 0;
    }
    return this._registration.status.userBalance * (1 + (Date.now() - this._lastRegistrationAt) * this._registration.interestRatePerMillisecond);
  }

  _fire(name, detail) {
    let ce = new CustomEvent(name, { bubbles: true, composed: true, detail: (detail || {}) });
    window.dispatchEvent(ce);
  }

}
window.customElements.define(CoreService.is, CoreService);
