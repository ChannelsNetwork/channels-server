const _CKeys = {
  KEYS: "channels-identity",
  BACKUP_KEYS: "backup-keys",
  AGREED_TERMS: "channels-terms-agreed"
};

class CoreService extends Polymer.Element {
  static get is() { return "core-service"; }
  constructor() {
    super();
    this.restBase = document.getElementById('restBase').getAttribute('href') || "";
    this.publicBase = document.getElementById('publicBase').getAttribute("href") || "";

    // child services
    this.storage = new StorageService();
    this.rest = new RestService();
    this.cardManager = new CardManager(this);
    this.userManager = new UserManager(this);

    this._keys = this.storage.getItem(_CKeys.KEYS, true);
    this._profile = null;
    this._pendingRegistrations = [];
  }

  agreeToTnCs() {
    this.storage.setItem(_CKeys.AGREED_TERMS, true, true);
  }

  isAgreedToTnCs() {
    return this.storage.getItem(_CKeys.AGREED_TERMS, false) ? true : false;
  }

  hasKeys() {
    return this._keys && this._keys.privateKey ? true : false;
  }

  _import(url) {
    return new Promise((resolve, reject) => {
      Polymer.importHref(this.resolveUrl(url), () => {
        resolve();
      }, (err) => {
        reject(err);
      });
    });
  }

  _loadKeyLib() {
    if (this._keyLibLoaded) {
      return new Promise((resolve, reject) => { resolve(); });
    }
    return this._import("../../bower_components/channels-web-utils/channels-key-utils.html").then(() => {
      this._keyLibLoaded = true;
    }).catch((err) => {
      console.error("Error importing channels-key-utils", err);
    });
  }

  ensureImageLib() {
    return this._import("utils/load-image.html");
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

  ensureKey(forceNewKeys) {
    return new Promise((resolve, reject) => {
      this._loadKeyLib().then(() => {
        if (!forceNewKeys && this._keys && this._keys.privateKey) {
          resolve();
          return;
        }
        this._keys = $keyUtils.generateKey();
        if (forceNewKeys) {
          this.storage.clearItem(_CKeys.BACKUP_KEYS);
        }
        this.storage.setItem(_CKeys.KEYS, this._keys, true);
        resolve();
      }).catch((err) => {
        reject(err);
      });
    });
  }

  register(inviteCode, retrying) {
    // We want to avoid race conditions where multiple entities all ask to register
    // at the same time.  We only want to register once, so we return a promise for
    // others and resolve them after resolving the initial request.
    if (this._registrationInProgress) {
      console.log("Concurrent registration being queued.");
      return new Promise((resolve, reject) => {
        this._pendingRegistrations.push(resolve);
      });
    }
    this._registrationInProgress = true;
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
        this._fire("channels-user-status", this._userStatus);
        this._fire("channels-registration", this._registration);
        return this.getUserProfile().then((profile) => {
          setInterval(() => {
            this.updateBalance();
          }, 1000 * 60);
          return result;
        });
      });
    }).then((info) => {
      this._registrationInProgress = false;
      this._resolvePendingRegistrations(info);
      return info;
    }).catch((err) => {
      this._registrationInProgress = false;
      if (err.code === 409 && !retrying) {
        console.warn("core.register: received 409 conflict, retrying with fresh keys");
        return this.ensureKey(true).then(() => {
          return this.register(null, true);
        });
      } else {
        this._resolvePendingRegistrations();
        throw err;
      }
    });
  }

  _resolvePendingRegistrations(info) {
    const registrations = this._pendingRegistrations;
    this._pendingRegistrations = [];
    for (const registration of registrations) {
      registration(info);
    }
  }

  signIn(handle, password, trust) {
    let details = RestUtils.signInDetails(handle);
    const url = this.restBase + "/sign-in";
    return this.rest.post(url, details).then((result) => {
      return EncryptionUtils.decryptString(result.encryptedPrivateKey, password).then((privateKey) => {
        const newKeys = $keyUtils.generateKey(privateKey);
        this._switchToSignedInKeys(newKeys, trust);
        return this.getUserProfile();
      }).catch((err) => {
        throw new Error("Your handle or password is incorrect.");
      });
    });
  }

  _switchToSignedInKeys(newKeys, trust) {
    if (this._keys && this._keys.privateKey !== newKeys.privateKey) {
      this.storage.setItem(_CKeys.BACKUP_KEYS, this._keys, true);
    } else {
      this.storage.clearItem(_CKeys.BACKUP_KEYS);
    }
    this._keys = newKeys;
    this.storage.setItem(_CKeys.KEYS, this._keys, trust);
  }

  _switchToBackupKeys() {
    const backupKeys = this.storage.getItem(_CKeys.BACKUP_KEYS, true);
    if (backupKeys && backupKeys.privateKey !== this._keys.privateKey) {
      this._keys = backupKeys;
    } else {
      this._keys = $keyUtils.generateKey();
      this.storage.setItem(_CKeys.BACKUP_KEYS, this._keys, true);
    }
    this.storage.setItem(_CKeys.KEYS, this._keys, true);
  }

  signOut() {
    this._switchToBackupKeys();
    this._profile = null;
    this._registration = null;
    return this.register();
  }

  getAccountStatus() {
    let details = RestUtils.accountStatusDetails(this._keys.address);
    let request = this._createRequest(details);
    const url = this.restBase + "/account-status";
    return this.rest.post(url, request).then((result) => {
      this._accountStatus = result;
      return result;
    });
  }

  registerDevice(deviceCode) {
    let details = RestUtils.registerDeviceDetails(this._keys.address, deviceCode);
    let request = this._createRequest(details);
    const url = this.restBase + "/register-device";
    return this.rest.post(url, request);
  }

  updateUserProfile(name, handle, location, imageUrl, email, password, trust) {
    if (password) {
      return EncryptionUtils.encryptString(this._keys.privateKey, password).then((encryptedPrivateKey) => {
        this.storage.setItem(_CKeys.KEYS, this._keys, trust);
        this.storage.clearItem(_CKeys.BACKUP_KEYS);
        return this._completeUserProfileUpdate(name, handle, location, imageUrl, email, password, encryptedPrivateKey);
      });
    } else {
      return this._completeUserProfileUpdate(name, handle, location, imageUrl, email, password);
    }
  }

  _completeUserProfileUpdate(name, handle, location, imageUrl, email, password, encryptedPrivateKey) {
    let details = RestUtils.updateIdentityDetails(this._keys.address, name, handle, location, imageUrl, email, encryptedPrivateKey);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-identity";
    return this.rest.post(url, request).then(() => {
      this._fire("profile-updated");
      return this.getUserProfile();
    })
  }

  getUserProfile() {
    let details = RestUtils.getUserIdentityDetails(this._keys.address);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-identity";
    return this.rest.post(url, request).then((profile) => {
      this._profile = profile;
      this._fire("channels-profile", this._profile);
      return profile;
    });
  }

  getHandleInfo(handle) {
    const details = RestUtils.getHandleDetails(this._keys.address, handle);
    const request = this._createRequest(details);
    const url = this.restBase + "/get-handle";
    return this.rest.post(url, request);
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

  requestRecoveryCode(handle, emailAddress) {
    let details = RestUtils.requestRecoveryCodeDetails(handle, emailAddress);
    const url = this.restBase + "/request-recovery-code";
    return this.rest.post(url, details);
  }

  recoverUser(code, handle, password, trust) {
    return EncryptionUtils.encryptString(this._keys.privateKey, password).then((encryptedPrivateKey) => {
      let details = RestUtils.recoverUserDetails(this._keys.address, code, handle, encryptedPrivateKey);
      let request = this._createRequest(details);
      const url = this.restBase + "/recover-user";
      return this.rest.post(url, request).then(() => {
        this.storage.setItem(_CKeys.KEYS, this._keys, trust);
        this.storage.clearItem(_CKeys.BACKUP_KEYS);
        this._profile = null;
        this._registration = null;
        return this.register();
      });
    });
  }

  getFeeds(maxCardsPerFeed) {
    let details = RestUtils.getFeedsDetails(this._keys.address, maxCardsPerFeed);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-feeds";
    return this.rest.post(url, request);
  }

  getFeed(type, maxCards, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds) {  // type = "recommended" | "new" | "mine" | "opened" | "channel"
    let details = RestUtils.getFeedsDetails(this._keys.address, maxCards, type, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-feeds";
    return this.rest.post(url, request).then((response) => {
      return response.feeds[0];
    });
  }

  ensureComponent(packageName) {
    let details = RestUtils.ensureComponentDetails(this._keys.address, packageName);
    let request = this._createRequest(details);
    const url = this.restBase + "/ensure-component";
    return this.rest.post(url, request);
  }

  getCard(cardId) {
    let details = RestUtils.getCardDetails(this._keys.address, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-card";
    return this.rest.post(url, request);
  }

  postCard(imageUrl, imageWidth, imageHeight, linkUrl, title, text, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, initialState) {
    let coupon;
    if (promotionFee + openPayment > 0) {
      const couponDetails = RestUtils.getCouponDetails(this._keys.address, promotionFee ? "card-promotion" : "card-open-payment", promotionFee + openPayment, budgetAmount, budgetPlusPercent);
      const couponDetailsString = JSON.stringify(couponDetails);
      coupon = {
        objectString: couponDetailsString,
        signature: this._sign(couponDetailsString)
      }
    }
    let details = RestUtils.postCardDetails(this._keys.address, imageUrl, imageWidth, imageHeight, linkUrl, title, text, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, initialState);
    let request = this._createRequest(details);
    const url = this.restBase + "/post-card";
    return this.rest.post(url, request);
  }

  updateCardSummary(cardId, title, text, linkUrl, imageUrl, imageWidth, imageHeight) {
    const cardSummary = RestUtils.cardStateSummary(title, text, linkUrl, imageUrl, imageWidth, imageHeight);
    const details = RestUtils.updateCardStateDetails(this._keys.address, cardId, cardSummary);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-state-update";
    return this.rest.post(url, request).then(() => {
      return cardSummary;
    });
  }

  updateCardState(cardId, state) {
    const details = RestUtils.updateCardStateDetails(this._keys.address, cardId, null, state);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-state-update";
    return this.rest.post(url, request);
  }

  updateCardPricing(cardId, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent) {
    let coupon;
    if (promotionFee + openPayment > 0) {
      const couponDetails = RestUtils.getCouponDetails(this._keys.address, promotionFee ? "card-promotion" : "card-open-payment", promotionFee + openPayment, budgetAmount, budgetPlusPercent);
      const couponDetailsString = JSON.stringify(couponDetails);
      coupon = {
        objectString: couponDetailsString,
        signature: this._sign(couponDetailsString)
      }
    }
    const details = RestUtils.updateCardState(this._keys.address, cardId, RestUtils.cardPricing(promotionFee, openPayment, openFeeUntis, budgetAmount, budgetPlusPercent, coupon));
    const url = this.restBase + "/card-pricing-update";
    return this.rest.post(url, request);
  }

  cardImpression(cardId, couponId, amount, authorAddress) {
    let details;
    if (couponId) {
      const recipient = RestUtils.bankTransactionRecipient(this._keys.address, "remainder", "coupon-redemption");
      const transaction = RestUtils.bankTransaction(authorAddress, "coupon-redemption", "card-promotion", cardId, couponId, amount, [recipient]);
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      details = RestUtils.cardImpressionDetails(this._keys.address, cardId, transactionString, transactionSignature);
    } else {
      details = RestUtils.cardImpressionDetails(this._keys.address, cardId);
    }
    let request = this._createRequest(details);
    const url = this.restBase + "/card-impression";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
    }).catch((err) => {
      console.warn("Card impression call failed: " + err);
    });
  }

  cardOpened(cardId) {
    let details = RestUtils.cardOpenedDetails(this._keys.address, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-opened";
    return this.rest.post(url, request);
  }

  cardPay(cardId, amount, authorAddress, cardDeveloperAddress, cardDeveloperFraction, referrerAddress) {
    const recipients = [];
    recipients.push(RestUtils.bankTransactionRecipient(authorAddress, "remainder", "content-purchase"));
    if (cardDeveloperAddress && cardDeveloperFraction && cardDeveloperFraction > 0) {
      recipients.push(RestUtils.bankTransactionRecipient(cardDeveloperAddress, "fraction", "card-developer-royalty", cardDeveloperFraction));
    }
    if (this._registration.operatorAddress) {
      recipients.push(RestUtils.bankTransactionRecipient(this._registration.operatorAddress, "fraction", "network-operations", this._registration.operatorTaxFraction));
    }
    if (this._registration.networkDeveloperAddress) {
      recipients.push(RestUtils.bankTransactionRecipient(this._registration.networkDeveloperAddress, "fraction", "network-creator-royalty", this._registration.networkDeveloperRoyaltyFraction));
    }
    if (referrerAddress) {
      recipients.push(RestUtils.bankTransactionRecipient(referrerAddress, "fraction", "referral-fee", this._registration.referralFraction));
    }
    const transaction = RestUtils.bankTransaction(this._keys.address, "transfer", "card-open-fee", cardId, null, amount, recipients);
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    let details = RestUtils.cardPayDetails(this._keys.address, cardId, transactionString, transactionSignature);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-pay";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
      return response;
    });
  }

  cardOpenPaymentRedeem(cardId, couponId, amount, authorAddress) {
    const recipient = RestUtils.bankTransactionRecipient(this._keys.address, "remainder", "coupon-redemption");
    const transaction = RestUtils.bankTransaction(authorAddress, "coupon-redemption", "card-open-payment", cardId, couponId, amount, [recipient]);
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    const details = RestUtils.cardRedeemOpenDetails(this._keys.address, cardId, transactionString, transactionSignature);
    const request = this._createRequest(details);
    const url = this.restBase + "/card-redeem-open";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
    });
  }

  cardClosed(cardId) {
    let details = RestUtils.cardClosedDetails(this._keys.address, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-closed";
    return this.rest.post(url, request);
  }

  updateCardLike(cardId, selection) {  // "like" | "none" | "dislike"
    let details = RestUtils.updateCardLikeDetails(this._keys.address, cardId, selection);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-card-like";
    return this.rest.post(url, request);
  }

  updateCardPrivate(cardId, isPrivate) {
    let details = RestUtils.updateCardPrivateDetails(this._keys.address, cardId, isPrivate);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-card-private";
    return this.rest.post(url, request);
  }

  deleteCard(cardId) {
    let details = RestUtils.deleteCardDetails(this._keys.address, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/delete-card";
    return this.rest.post(url, request);
  }

  bankStatement(maxCount) {
    let details = RestUtils.bankStatementDetails(this._keys.address, maxCount);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-statement";
    return this.rest.post(url, request);
  }

  withdraw(amount, emailAddress) {
    const transaction = RestUtils.bankTransaction(this._keys.address, "withdrawal", "withdrawal", null, null, amount, [], RestUtils.bankTransactionWithdrawalRecipient(emailAddress));
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    let details = RestUtils.bankWithdraw(this._keys.address, transactionString, transactionSignature);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-withdraw";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
      return response;
    });
  }

  cardStatsHistory(cardId, historyLimit) {
    let details = RestUtils.cardStatsHistoryDetails(this._keys.address, cardId, historyLimit);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-stat-history";
    return this.rest.post(url, request);
  }

  generateDepositClientToken() {
    let details = RestUtils.generateClientToken(this._keys.address);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-client-token";
    return this.rest.post(url, request);
  }

  depositCheckout(amount, nonce) {
    let details = RestUtils.clientCheckout(this._keys.address, amount, nonce);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-client-checkout";
    return this.rest.post(url, request);
  }

  uploadImageFile(imageFile, filename, maxWidth) {
    return this.ensureImageLib().then(() => {
      return CoreImageUtils.resample(imageFile, maxWidth, true).then((blob) => {
        return this.uploadFile(blob, filename || imageFile.name || "unnamed.jpg");
      });
    });
  }

  uploadFile(file, filename) {
    var formData = new FormData();
    // if ((file instanceof Blob) && (!file.name)) {
    //   file = new File([file], filename ? filename : 'unnamed', { type: file.type, lastModified: Date.now() });
    // }
    formData.append("address", this._keys.address);
    const signatureTimestamp = Date.now().toString();
    formData.append("signatureTimestamp", signatureTimestamp);
    formData.append("signature", this._sign(signatureTimestamp));
    formData.append("fileName", filename || file.name || "unnamed");
    formData.append("userFile", file);

    const url = this.restBase + "/upload";
    return this.rest.postFile(url, formData);
  }

  isValidEmail(emailAddress) {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(emailAddress);
  }

  isValidPaypalRecipient(value) {
    if (!value) {
      return false;
    }
    const reEmail = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    const isEmail = reEmail.test(value);
    if (isEmail) {
      return true;
    }
    const phoneNumber = value.split(/[\-\.\(\)\s/]+/).join("");
    if (/^[0-9]{10,16}$/.test(phoneNumber)) {
      return true;
    }
    const rePaypalMeLink = /^(https?\:\/\/)?paypal\.me\/\S+$/i;
    if (rePaypalMeLink.test(value)) {
      return true;
    }
    return false;
  }

  get profile() {
    return this._profile;
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
    return 1;
  }

  get depositUrl() {
    return this._registration.depositUrl;
  }

  get withdrawalsEnabled() {
    if (!this._registration) {
      return false;
    }
    return this._registration.withdrawalsEnabled;
  }

  get balance() {
    if (!this._userStatus || !this._registration) {
      return 0;
    }
    let result = this._userStatus.userBalance * (1 + (Date.now() - this._userStatus.userBalanceAt) * this.registration.interestRatePerMillisecond);
    if (result < this._userStatus.targetBalance) {
      const addition = (Date.now() - this._userStatus.userBalanceAt) * this.registration.subsidyRate;
      if (result + addition >= this._userStatus.targetBalance) {
        this._userStatus.userBalance = this._userStatus.targetBalance;
        this._userStatus.userBalanceAt = Date.now();
      } else {
        result += addition;
      }
    }
    return result;
  }

  get minBalanceAfterWithdrawal() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.minBalanceAfterWithdrawal;
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

  get networkTotalPublisherRevenue() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.totalPublisherRevenue;
  }

  get networkTotalCardDeveloperRevenue() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.totalCardDeveloperRevenue;
  }

  _fire(name, detail) {
    let ce = new CustomEvent(name, { bubbles: true, composed: true, detail: (detail || {}) });
    window.dispatchEvent(ce);
  }

  updateBalance() {
    return this.getAccountStatus().then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
    });
  }
}
window.customElements.define(CoreService.is, CoreService);