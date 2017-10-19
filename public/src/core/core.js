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
        this._userStatus = result.status;
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

  getFeed(type, maxCards, startWithCardId) {  // type = "recommended" | "new" | "mine" | "opened"
    return this.ensureKey().then(() => {
      let details = RestUtils.getFeedDetails(this._keys.address, maxCards, type, startWithCardId);
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

  postCard(imageUrl, linkUrl, title, text, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, initialState) {
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
      let details = RestUtils.postCardDetails(this._keys.address, imageUrl, linkUrl, title, text, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, initialState);
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
        this._userStatus = response.status;
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

  cardPay(cardId, amount, authorAddress, cardDeveloperAddress, cardDeveloperFraction, referrerAddress) {
    return this.ensureKey().then(() => {
      const recipients = [];
      recipients.push(RestUtils.bankTransactionRecipient(authorAddress, "remainder"));
      if (cardDeveloperAddress && cardDeveloperFraction && cardDeveloperFraction > 0) {
        recipients.push(RestUtils.bankTransactionRecipient(cardDeveloperAddress, "fraction", cardDeveloperFraction));
      }
      if (this._registration.operatorAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(this._registration.operatorAddress, "fraction", this._registration.operatorTaxFraction));
      }
      if (this._registration.networkDeveloperAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(this._registration.networkDeveloperAddress, "fraction", this._registration.networkDeveloperRoyaltyFraction));
      }
      if (referrerAddress) {
        recipients.push(RestUtils.bankTransactionRecipient(referrerAddress, "fraction", this._registration.referralFraction));
      }
      const transaction = RestUtils.bankTransaction(this._keys.address, "transfer", "card-open-fee", cardId, null, amount, recipients);
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      let details = RestUtils.cardPayDetails(this._keys.address, cardId, transactionString, transactionSignature);
      let request = this._createRequest(details);
      const url = this.restBase + "/card-pay";
      return this.rest.post(url, request).then((response) => {
        this._userStatus = response.status;
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
        this._userStatus = response.status;
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

  updateCardPrivate(cardId, isPrivate) {
    return this.ensureKey().then(() => {
      let details = RestUtils.updateCardPrivateDetails(this._keys.address, cardId, isPrivate);
      let request = this._createRequest(details);
      const url = this.restBase + "/update-card-private";
      return this.rest.post(url, request);
    });
  }

  deleteCard(cardId) {
    return this.ensureKey().then(() => {
      let details = RestUtils.deleteCardDetails(this._keys.address, cardId);
      let request = this._createRequest(details);
      const url = this.restBase + "/delete-card";
      return this.rest.post(url, request);
    });
  }

  bankStatement(maxCount) {
    return this.ensureKey().then(() => {
      let details = RestUtils.bankStatementDetails(this._keys.address, maxCount);
      let request = this._createRequest(details);
      const url = this.restBase + "/bank-statement";
      return this.rest.post(url, request);
    });
  }

  withdraw(amount, emailAddress) {
    return this.ensureKey().then(() => {
      const transaction = RestUtils.bankTransaction(this._keys.address, "withdrawal", "withdrawal", null, null, amount, [], RestUtils.bankTransactionWithdrawalRecipient(emailAddress));
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      let details = RestUtils.bankWithdraw(this._keys.address, transactionString, transactionSignature);
      let request = this._createRequest(details);
      const url = this.restBase + "/bank-withdraw";
      return this.rest.post(url, request).then((response) => {
        this._userStatus = response.status;
        return response;
      });
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

  isValidEmail(emailAddress) {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(emailAddress);
  }

  get profile() {
    return this._profile;
  }

  get userId() {
    return this._registration ? this._registration.userId : null;
  }

  get address() {
    return this._keys ? this._keys.address : null;
  }

  get hasKey() {
    return (this._keys && this._keys.privateKey);
  }

  get registration() {
    return this._registration;
  }

  get coinSellExchangeRate() {
    return 0.98;
  }

  get withdrawalsEnabled() {
    if (!this._registration) {
      return false;
    }
    return this._registration.withdrawalsEnabled;
  }

  get balance() {
    if (!this._userStatus) {
      return 0;
    }
    let result = this._userStatus.userBalance * (1 + (Date.now() - this._userStatus.userBalanceAt) * this.registration.interestRatePerMillisecond);
    if (result < this._userStatus.targetBalance) {
      result += (Date.now() - this._userStatus.userBalanceAt) * this.registration.subsidyRate;
      result = Math.min(result, this._userStatus.targetBalance);
    }
    return result;
  }

  get withdrawableBalance() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.withdrawableBalance;
  }

  get baseCardPrice() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.cardBasePrice;
  }

  get operatorAddress() {
    return this._registration ? this._registration.operatorAddress : null;
  }

  get networkDeveloperAddress() {
    return this._registration ? this._registration.networkDeveloperAddress : null;
  }

  _fire(name, detail) {
    let ce = new CustomEvent(name, { bubbles: true, composed: true, detail: (detail || {}) });
    window.dispatchEvent(ce);
  }

  _updateBalance() {
    this.getAccountStatus().then((response) => {
      this._userStatus = response.status;
    });
  }

}
window.customElements.define(CoreService.is, CoreService);
