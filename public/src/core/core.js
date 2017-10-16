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

    // child services
    this.storage = new StorageService();
    this.rest = new RestService();
    this.dummy = new DummyService(this);
    this.cardManager = new CardManager(this);

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
        this._statusResponse = result;
        this._fire("channels-registration", this._registration);
        this.getUserProfile();
        setInterval(() => {
          this._updateBalance();
        }, 1000 * 60);
        return result;
      });
    });
  }

  getAccountStatus() {
    return this.ensureKey().then(() => {
      let details = RestUtils.accountStatusDetails(this._keys.address);
      let request = this._createRequest(details);
      const url = this.restBase + "/account-status";
      return this.rest.post(url, request).then((result) => {
        this._accountStatus = result;
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
      return this.rest.post(url, request).then((response) => {
        return response.feeds[0].cards;
      });
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

  postCard(imageUrl, linkUrl, title, text, packageName, packageIconUrl, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, initialState) {
    return this.ensureKey().then(() => {
      let coupon;
      if (promotionFee + openPayment > 0) {
        const couponDetails = RestUtils.getCouponDetails(this._keys.address, promotionFee ? "card-promotion" : "card-open-payment", promotionFee + openPayment, budgetAmount, budgetPlusPercent);
        const couponDetailsString = JSON.stringify(couponDetails);
        const coupon = {
          objectString: couponDetailsString,
          signature: this._sign(couponDetailsString)
        }
      }
      let details = RestUtils.postCardDetails(this._keys.address, imageUrl, linkUrl, title, text, packageName, packageIconUrl, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, initialState);
      let request = this._createRequest(details);
      const url = this.restBase + "/post-card";
      return this.rest.post(url, request);
    });
  }

  cardImpression(cardId, coupon) {
    return this.ensureKey().then(() => {
      let details = RestUtils.cardImpressionDetails(this._keys.address, cardId, coupon);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-impression";
      return this.rest.post(url, request).then((response) => {
        this._statusResponse = response;
      });
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
      const transaction = RestUtils.bankTransaction(this._keys.address, "transfer", "card-open-fee", cardId, null, amount, recipients);
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      let details = RestUtils.cardPayDetails(this._keys.address, cardId, transactionString, transactionSignature);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-pay";
      return this.rest.post(url, request).then((response) => {
        this._statusResponse = response;
        return response;
      });
    });
  }

  cardOpenPaymentRedeem(cardId, coupon) {
    return this.ensureKey().then(() => {
      let details = RestUtils.cardRedeemOpenDetails(this._keys.address, cardId, coupon);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-redeem-open";
      return this.rest.post(url, request).then((response) => {
        this._statusResponse = response;
      });
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

  uploadFile(file) {
    return this.ensureKey().then(() => {
      var formData = new FormData();

      formData.append("address", this._keys.address);
      const signatureTimestamp = Date.now().toString();
      formData.append("signatureTimestamp", signatureTimestamp);
      formData.append("signature", this._sign(signatureTimestamp));
      formData.append("userFile", file);

      const url = this.restBase + "/upload";
      return this.rest.postFile(url, formData);
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
    if (!this._statusResponse) {
      return 0;
    }
    let result = this._statusResponse.status.userBalance * (1 + (Date.now() - this._statusResponse.status.userBalanceAt) * this._statusResponse.interestRatePerMillisecond);
    if (result < this._statusResponse.status.targetBalance) {
      result += (Date.now() - this._statusResponse.status.userBalanceAt) * this._statusResponse.subsidyRate;
      result = Math.min(result, this._statusResponse.status.targetBalance);
    }
    return result;
  }

  get baseCardPrice() {
    if (!this._statusResponse) {
      return 0;
    }
    return this._statusResponse.cardBasePrice;
  }

  _fire(name, detail) {
    let ce = new CustomEvent(name, { bubbles: true, composed: true, detail: (detail || {}) });
    window.dispatchEvent(ce);
  }

  _updateBalance() {
    this.getAccountStatus().then((status) => {
      this._statusResponse = status;
    });
  }

}
window.customElements.define(CoreService.is, CoreService);
