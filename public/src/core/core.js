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
    this.social = new SocialService();
    this.visibility = new PageVisibilityManager();
    this.notificationManager = new NotificationManager();
    this.analytics = {
      event: function (category, action) {
        if (window.ga) {
          try {
            window.ga('send', 'event', category, action);
          } catch (err) { console.warn(err); }
        }
      },
      page: function (pathname) {
        if (window.ga) {
          try {
            window.ga('send', 'pageview', pathname);
          } catch (err) { console.warn(err); }
        }
      },
      setUser: function (address) {
        if (address) {
          if (window.ga) {
            try {
              window.ga('set', 'userId', address);
            } catch (err) { console.warn(err); }
          } else {
            window._pending_ga_address = address;
          }
        }
      }
    };

    this._keys = this.storage.getItem(_CKeys.KEYS, true);
    this._profile = null;
    this._pendingRegistrations = [];
  }

  _isMobile() {
    const userAgent = window.navigator ? window.navigator.userAgent : '';
    return (userAgent.toLowerCase().indexOf('mobi') >= 0) && (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0));
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

  _generateFingerprint() {
    return new Promise((resolve, reject) => {
      new Fingerprint2().get((result, components) => {
        this._fingerprint = result;
        resolve();
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
      return this._generateFingerprint().then(() => {
        const referrer = document.referrer;
        const landingPageUrl = window.location.href;
        let landingCardId = null;
        if (landingPageUrl && /\/c\/\S+$/i.test(landingPageUrl)) {
          landingCardId = landingPageUrl.toLowerCase().split("/c/")[1].split("?")[0];
        }
        const userAgent = window.navigator ? window.navigator.userAgent : null;
        let details = RestUtils.registerUserDetails(this._keys.address, this._fingerprint, this._keys.publicKeyPem, inviteCode, referrer, landingPageUrl, userAgent, landingCardId);
        let request = this._createRequest(details);
        const url = this.restBase + "/register-user";
        return this.rest.post(url, request).then((result) => {
          this._registration = result;
          this._userStatus = result.status;
          this._fire("channels-user-status", this._userStatus);
          this._fire("channels-registration", this._registration);
          this.analytics.setUser(this._keys.address);
          return this.getUserProfile().then((profile) => {
            setInterval(() => {
              this.updateBalance();
            }, 1000 * 60);
            return result;
          });
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

  signIn(handleOrEmail, password, trust) {
    let details = RestUtils.signInDetails(this._keys.address, this._fingerprint, handleOrEmail);
    const url = this.restBase + "/sign-in";
    return this.rest.post(url, details).then((result) => {
      return EncryptionUtils.decryptString(result.encryptedPrivateKey, password).then((privateKey) => {
        const newKeys = $keyUtils.generateKey(privateKey);
        this._switchToSignedInKeys(newKeys, trust);
        this.agreeToTnCs();
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
    this._updateNotifications();
    return this.register();
  }

  getAccountStatus() {
    let details = RestUtils.accountStatusDetails(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/account-status";
    return this.rest.post(url, request).then((result) => {
      this._accountStatus = result;
      return result;
    });
  }

  updateUserProfile(name, handle, location, imageId, email, password, trust) {
    if (password) {
      return EncryptionUtils.encryptString(this._keys.privateKey, password).then((encryptedPrivateKey) => {
        this.storage.setItem(_CKeys.KEYS, this._keys, trust);
        this.storage.clearItem(_CKeys.BACKUP_KEYS);
        return this._completeUserProfileUpdate(name, handle, location, imageId, email, password, encryptedPrivateKey);
      });
    } else {
      return this._completeUserProfileUpdate(name, handle, location, imageId, email, password);
    }
  }

  _completeUserProfileUpdate(name, handle, location, imageId, email, password, encryptedPrivateKey) {
    let details = RestUtils.updateIdentityDetails(this._keys.address, this._fingerprint, name, handle, location, imageId, email, encryptedPrivateKey);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-identity";
    return this.rest.post(url, request).then(() => {
      this._fire("profile-updated");
      return this.getUserProfile();
    });
  }

  _updateNotifications() {
    this.notificationManager.clear();
    if (this._profile && this.profile.handle) {
      if (!this.profile.emailConfirmed) {
        this.notificationManager.add("Your email address has not been confirmed. Check your inbox for a confirmation email.", "/account");
      }
    }
  }

  getUserProfile() {
    let details = RestUtils.getUserIdentityDetails(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-identity";
    return this.rest.post(url, request).then((profile) => {
      this._profile = profile;
      this._fire("channels-profile", this._profile);
      this._updateNotifications();
      return profile;
    });
  }

  getHandleInfo(handle) {
    const details = RestUtils.getHandleDetails(this._keys.address, this._fingerprint, handle);
    const request = this._createRequest(details);
    const url = this.restBase + "/get-handle";
    return this.rest.post(url, request);
  }

  checkHandle(handle) {
    return this._loadKeyLib().then(() => {
      let request;
      if (this.hasKey) {
        let details = RestUtils.checkHandleDetails(this._keys.address, this._fingerprint, handle);
        request = this._createRequest(details);
      } else {
        let details = RestUtils.checkHandleDetails(null, this._fingerprint, handle);
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
      let details = RestUtils.recoverUserDetails(this._keys.address, this._fingerprint, code, handle, encryptedPrivateKey);
      let request = this._createRequest(details);
      const url = this.restBase + "/recover-user";
      return this.rest.post(url, request).then(() => {
        this.storage.setItem(_CKeys.KEYS, this._keys, trust);
        this.storage.clearItem(_CKeys.BACKUP_KEYS);
        this._profile = null;
        this._registration = null;
        this._updateNotifications();
        return this.register();
      });
    });
  }

  getFeeds(maxCardsPerFeed) {
    let details = RestUtils.getFeedsDetails(this._keys.address, this._fingerprint, maxCardsPerFeed);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-feeds";
    return this.rest.post(url, request);
  }

  getFeed(type, maxCards, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds) {  // type = "recommended" | "new" | "mine" | "opened" | "channel"
    let details = RestUtils.getFeedsDetails(this._keys.address, this._fingerprint, maxCards, type, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-feeds";
    return this.rest.post(url, request).then((response) => {
      return response.feeds[0];
    });
  }

  getTopFeeds(maxCardsPerFeed) {
    let details = RestUtils.getTopFeedsDetails(this._keys.address, this._fingerprint, maxCardsPerFeed);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-feeds";
    return this.rest.post(url, request).then((response) => {
      return response.feeds;
    });
  }

  search(searchString, limitCards, limitChannels) {
    let details = RestUtils.search(this._keys.address, this._fingerprint, searchString, limitCards, limitChannels);
    let request = this._createRequest(details);
    const url = this.restBase + "/search";
    return this.rest.post(url, request).then((response) => {
      return response;
    });
  }

  searchMoreCards(searchString, skip, limit) {
    let details = RestUtils.searchMoreCards(this._keys.address, this._fingerprint, searchString, skip, limit);
    let request = this._createRequest(details);
    const url = this.restBase + "/search-more-cards";
    return this.rest.post(url, request).then((response) => {
      return response;
    });
  }

  searchMoreChannels(searchString, skip, limit) {
    let details = RestUtils.searchMoreChannels(this._keys.address, this._fingerprint, searchString, skip, limit);
    let request = this._createRequest(details);
    const url = this.restBase + "/search-more-channels";
    return this.rest.post(url, request).then((response) => {
      return response;
    });
  }

  ensureComponent(packageName) {
    let details = RestUtils.ensureComponentDetails(this._keys.address, this._fingerprint, packageName);
    let request = this._createRequest(details);
    const url = this.restBase + "/ensure-component";
    return this.rest.post(url, request);
  }

  getCard(cardId, includePromotedCard, channelIdContext, commentCount) {
    let details = RestUtils.getCardDetails(this._keys.address, this._fingerprint, cardId, includePromotedCard, channelIdContext, commentCount);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-card";
    return this.rest.post(url, request);
  }

  postCard(imageId, linkURL, iframeUrl, title, text, langCode, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, keywords, searchText, fileIds, initialState) {
    let coupon;
    if (promotionFee + openPayment > 0) {
      const couponDetails = RestUtils.getCouponDetails(this._keys.address, this._fingerprint, promotionFee ? "card-promotion" : (linkURL ? "card-click-payment" : "card-open-payment"), promotionFee + openPayment, budgetAmount, budgetPlusPercent);
      const couponDetailsString = JSON.stringify(couponDetails);
      coupon = {
        objectString: couponDetailsString,
        signature: this._sign(couponDetailsString)
      }
    }
    let details = RestUtils.postCardDetails(this._keys.address, this._fingerprint, imageId, linkURL, iframeUrl, title, text, langCode, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, keywords, searchText, fileIds, initialState);
    let request = this._createRequest(details);
    const url = this.restBase + "/post-card";
    return this.rest.post(url, request);
  }

  updateCardSummary(cardId, title, text, langCode, linkURL, imageId, imageURL, keywords) {
    const cardSummary = RestUtils.cardStateSummary(title, text, langCode, linkURL, imageId, imageURL);
    const details = RestUtils.updateCardStateDetails(this._keys.address, this._fingerprint, cardId, cardSummary, null, keywords);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-state-update";
    return this.rest.post(url, request).then(() => {
      return cardSummary;
    });
  }

  updateCardState(cardId, state) {
    const details = RestUtils.updateCardStateDetails(this._keys.address, this._fingerprint, cardId, null, state);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-state-update";
    return this.rest.post(url, request);
  }

  updateCardPricing(cardId, openFeeUnits) {
    const details = RestUtils.updateCardPricing(this._keys.address, this._fingerprint, cardId, openFeeUnits);
    const url = this.restBase + "/card-pricing-update";
    return this.rest.post(url, request);
  }

  cardImpression(cardId, adSlotId, couponId, amount, authorAddress) {
    let details;
    if (couponId) {
      const recipient = RestUtils.bankTransactionRecipient(this._keys.address, "remainder", "coupon-redemption");
      const transaction = RestUtils.bankTransaction(authorAddress, this._fingerprint, "coupon-redemption", "card-promotion", cardId, couponId, amount, [recipient]);
      const transactionString = JSON.stringify(transaction);
      const transactionSignature = this._sign(transactionString);
      details = RestUtils.cardImpressionDetails(this._keys.address, this._fingerprint, cardId, adSlotId, transactionString, transactionSignature);
    } else {
      details = RestUtils.cardImpressionDetails(this._keys.address, this._fingerprint, cardId, adSlotId);
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

  cardOpened(cardId, adSlotId) {
    let details = RestUtils.cardOpenedDetails(this._keys.address, this._fingerprint, cardId, adSlotId);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-opened";
    return this.rest.post(url, request);
  }

  cardClicked(cardId, adSlotId, couponId, amount, authorAddress) {
    let transactionString = null;
    let transactionSignature = null;
    if (couponId && amount && authorAddress) {
      const recipient = RestUtils.bankTransactionRecipient(this._keys.address, "remainder", "coupon-redemption");
      const transaction = RestUtils.bankTransaction(authorAddress, this._fingerprint, "coupon-redemption", "card-click-payment", cardId, couponId, amount, [recipient]);
      transactionString = JSON.stringify(transaction);
      transactionSignature = this._sign(transactionString);
    }
    let details = RestUtils.cardClickedDetails(this._keys.address, this._fingerprint, cardId, adSlotId, transactionString, transactionSignature);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-clicked";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
    });
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
    const transaction = RestUtils.bankTransaction(this._keys.address, this._fingerprint, "transfer", "card-open-fee", cardId, null, amount, recipients);
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    let details = RestUtils.cardPayDetails(this._keys.address, this._fingerprint, cardId, transactionString, transactionSignature, this._isMobile());
    let request = this._createRequest(details);
    const url = this.restBase + "/card-pay";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
      return response;
    });
  }

  cardOpenPaymentRedeem(cardId, adSlotId, couponId, amount, authorAddress) {
    const recipient = RestUtils.bankTransactionRecipient(this._keys.address, "remainder", "coupon-redemption");
    const transaction = RestUtils.bankTransaction(authorAddress, this._fingerprint, "coupon-redemption", "card-open-payment", cardId, couponId, amount, [recipient]);
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    const details = RestUtils.cardRedeemOpenDetails(this._keys.address, this._fingerprint, cardId, adSlotId, transactionString, transactionSignature);
    const request = this._createRequest(details);
    const url = this.restBase + "/card-redeem-open";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
    });
  }

  cardClosed(cardId) {
    let details = RestUtils.cardClosedDetails(this._keys.address, this._fingerprint, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-closed";
    return this.rest.post(url, request);
  }

  updateCardLike(cardId, selection) {  // "like" | "none" | "dislike"
    let details = RestUtils.updateCardLikeDetails(this._keys.address, this._fingerprint, cardId, selection);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-card-like";
    return this.rest.post(url, request);
  }

  updateCardPrivate(cardId, isPrivate) {
    let details = RestUtils.updateCardPrivateDetails(this._keys.address, this._fingerprint, cardId, isPrivate);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-card-private";
    return this.rest.post(url, request);
  }

  deleteCard(cardId) {
    let details = RestUtils.deleteCardDetails(this._keys.address, this._fingerprint, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/delete-card";
    return this.rest.post(url, request);
  }

  bankStatement(maxCount) {
    let details = RestUtils.bankStatementDetails(this._keys.address, this._fingerprint, maxCount);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-statement";
    return this.rest.post(url, request);
  }

  withdraw(amount, emailAddress) {
    const transaction = RestUtils.bankTransaction(this._keys.address, this._fingerprint, "withdrawal", "withdrawal", null, null, amount, [], RestUtils.bankTransactionWithdrawalRecipient(emailAddress));
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = this._sign(transactionString);
    let details = RestUtils.bankWithdraw(this._keys.address, this._fingerprint, transactionString, transactionSignature);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-withdraw";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
      return response;
    });
  }

  cardStatsHistory(cardId, historyLimit) {
    let details = RestUtils.cardStatsHistoryDetails(this._keys.address, this._fingerprint, cardId, historyLimit);
    let request = this._createRequest(details);
    const url = this.restBase + "/card-stat-history";
    return this.rest.post(url, request);
  }

  generateDepositClientToken() {
    let details = RestUtils.generateClientToken(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-client-token";
    return this.rest.post(url, request);
  }

  depositCheckout(amount, nonce) {
    let details = RestUtils.clientCheckout(this._keys.address, this._fingerprint, amount, nonce);
    let request = this._createRequest(details);
    const url = this.restBase + "/bank-client-checkout";
    return this.rest.post(url, request);
  }

  discardFiles(fileIds) {
    let details = RestUtils.discardFiles(this._keys.address, this._fingerprint, fileIds);
    let request = this._createRequest(details);
    const url = this.restBase + "/discard-files";
    return this.rest.post(url, request);
  }

  queryPage(queryUrl) {
    let details = RestUtils.queryPage(this._keys.address, this._fingerprint, queryUrl);
    let request = this._createRequest(details);
    const url = this.restBase + "/query-page";
    return this.rest.post(url, request);
  }

  listTopics() {
    let details = RestUtils.listTopicsDetails(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/list-topics";
    return this.rest.post(url, request);
  }

  searchTopic(topic, maxCount, afterCardId, promotedCardIds) {
    let details = RestUtils.searchTopicDetails(this._keys.address, this._fingerprint, topic, maxCount, afterCardId, promotedCardIds);
    let request = this._createRequest(details);
    const url = this.restBase + "/search-topic";
    return this.rest.post(url, request);
  }

  getChannelByOwnerHandle(ownerHandle) {
    let details = RestUtils.getChannelDetails(this._keys.address, this._fingerprint, null, null, ownerHandle, null);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-channel";
    return this.rest.post(url, request);
  }

  getChannelByChannelHandle(channelHandle) {
    let details = RestUtils.getChannelDetails(this._keys.address, this._fingerprint, null, null, null, channelHandle);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-channel";
    return this.rest.post(url, request);
  }

  // export type ChannelFeedType = "recommended" | "new" | "subscribed" | "blocked";
  getChannels(feedType, maxCount, nextPageRef) {
    let details = RestUtils.getChannelsDetails(this._keys.address, this._fingerprint, feedType, maxCount, nextPageRef);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-channels";
    return this.rest.post(url, request);
  }

  updateChannel(channelId, name, bannerImageFileId, about, link, socialLinks) {
    let details = RestUtils.updateChannelDetails(this._keys.address, this._fingerprint, channelId, name, bannerImageFileId, about, link, socialLinks);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-channel";
    return this.rest.post(url, request);
  }

  updateChannelSubscription(channelId, state) {
    let details = RestUtils.updateChannelSubscriptionDetails(this._keys.address, this._fingerprint, channelId, state);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-channel-subscription";
    window.__dirtyFeed = true;
    return this.rest.post(url, request);
  }

  reportChannelVisit(channelId) {
    let details = RestUtils.reportChannelVisitDetails(this._keys.address, this._fingerprint, channelId);
    let request = this._createRequest(details);
    const url = this.restBase + "/report-channel-visit";
    return this.rest.post(url, request);
  }

  requestEmailConfirmation() {
    let details = RestUtils.requestEmailConfirmationDetails(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/request-email-confirmation";
    return this.rest.post(url, request);
  }

  confirmEmail(code) {
    let details = RestUtils.confirmEmailDetails(this._keys.address, this._fingerprint, code);
    let request = this._createRequest(details);
    const url = this.restBase + "/confirm-email";
    return this.rest.post(url, request).then(() => {
      return this.getUserProfile();
    });
  }

  updateAccountSettings(settings) {
    let details = RestUtils.updateAccountSettingsDetails(this._keys.address, this._fingerprint, settings);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-account-settings";
    return this.rest.post(url, request).then((profile) => {
      this._profile = profile;
      this._fire("channels-profile", this._profile);
      this._updateNotifications();
      return profile.accountSettings;
    });
  }

  reportCard(cardId, reasons, comment, requestRefund, adminBlockCard, adminBlockUser) {
    let details = RestUtils.reportCardDetails(this._keys.address, this._fingerprint, cardId, reasons, comment, requestRefund, adminBlockCard, adminBlockUser);
    let request = this._createRequest(details);
    const url = this.restBase + "/report-card";
    return this.rest.post(url, request).then((response) => {
      this._userStatus = response.status;
      this._fire("channels-user-status", this._userStatus);
      return response;
    });
  }

  getHome(maxSubscribedCards, maxCardsPerChannel) {
    let details = RestUtils.getHome(this._keys.address, this._fingerprint, maxSubscribedCards, maxCardsPerChannel);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-home";
    return this.rest.post(url, request);
  }

  getChannelCard(channelId, cardId) {
    let details = RestUtils.updateChannelCard(this._keys.address, this._fingerprint, channelId, cardId);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-channel-card";
    return this.rest.post(url, request);
  }

  updateChannelCard(channelId, cardId, includeInChannel) {
    let details = RestUtils.updateChannelCard(this._keys.address, this._fingerprint, channelId, cardId, includeInChannel);
    let request = this._createRequest(details);
    const url = this.restBase + "/update-channel-card";
    return this.rest.post(url, request);
  }

  postCardComment(cardId, text, metadata) {
    let details = RestUtils.postCardComment(this._keys.address, this._fingerprint, cardId, text, metadata);
    let request = this._createRequest(details);
    const url = this.restBase + "/post-card-comment";
    return this.rest.post(url, request);
  }

  getCardComments(cardId, before, maxCount) {
    let details = RestUtils.getCardComments(this._keys.address, this._fingerprint, cardId, before, maxCount);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-card-comments";
    return this.rest.post(url, request);
  }

  setChannelCardPinning(channelId, cardId, pinned) {
    let details = RestUtils.setChannelCardPinning(this._keys.address, this._fingerprint, channelId, cardId, pinned);
    let request = this._createRequest(details);
    const url = this.restBase + "/set-channel-card-pinning";
    return this.rest.post(url, request);
  }

  getChannelSubscribers(channelId, maxCount, afterSubscriberId) {
    let details = RestUtils.getChannelSubscribers(this._keys.address, this._fingerprint, channelId, maxCount, afterSubscriberId);
    let request = this._createRequest(details);
    const url = this.restBase + "/get-channel-subscribers";
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
    const rePaypalMeLink = /^(https?\:\/\/)?(www\.)?paypal\.me\/\S+$/i;
    if (rePaypalMeLink.test(value)) {
      return true;
    }
    return false;
  }

  get profile() {
    return this._profile;
  }

  get isAdmin() {
    return this.registration && this.registration.admin;
  }

  get homeChannelId() {
    return this._profile ? this._profile.homeChannelId : null;
  }

  get accountSettings() {
    if (!this._profile) {
      return null;
    }
    return this._profile.accountSettings;
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

  get timeUntilNextAllowedWithdrawal() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.timeUntilNextAllowedWithdrawal;
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

  get userId() {
    return this._registration ? this._registration.id : null;
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

  get lastLanguagePublished() {
    if (!this._userStatus) {
      return null;
    }
    return this._userStatus.lastLanguagePublished;
  }

  get networkTotalCardDeveloperRevenue() {
    if (!this._userStatus) {
      return 0;
    }
    return this._userStatus.totalCardDeveloperRevenue;
  }

  get publishSubsidiesRemainingToday() {
    if (!this._userStatus || !this._userStatus.publisherSubsidies) {
      return 0;
    }
    return this._userStatus.publisherSubsidies.remainingToday || 0;
  }

  get publishSubsidiesPerPaidOpenReturningUser() {
    if (!this._userStatus || !this._userStatus.publisherSubsidies) {
      return 0;
    }
    return this._userStatus.publisherSubsidies.returnUserBonus || 0;
  }

  get publishSubsidiesPerPaidOpenNewUser() {
    if (!this._userStatus || !this._userStatus.publisherSubsidies) {
      return 0;
    }
    return this._userStatus.publisherSubsidies.newUserBonus || 0;
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

  admin_getUsers(withIdentityOnly, limit) {
    let details = RestUtils.admin_getUsers(this._keys.address, this._fingerprint, withIdentityOnly, limit);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-get-users";
    return this.rest.post(url, request);
  }

  admin_getCards(limit) {
    let details = RestUtils.admin_getCards(this._keys.address, this._fingerprint, limit);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-get-cards";
    return this.rest.post(url, request);
  }

  admin_setUserMailingList(userId, includeInMailingList) {
    let details = RestUtils.admin_setUserMailingList(this._keys.address, this._fingerprint, userId, includeInMailingList);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-set-user-mailing-list";
    return this.rest.post(url, request);
  }

  admin_updateCard(cardId, keywords, blocked, boost, overrideReports) {
    let details = RestUtils.admin_updateCard(this._keys.address, this._fingerprint, cardId, keywords, blocked, boost, overrideReports);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-update-card";
    return this.rest.post(url, request);
  }

  admin_updateChannel(channelId, featuredWeight, listingWeight) {
    let details = RestUtils.admin_updateChannel(this._keys.address, this._fingerprint, channelId, featuredWeight, listingWeight);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-update-channel";
    return this.rest.post(url, request);
  }

  admin_getGoals() {
    let details = RestUtils.admin_getGoals(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-goals";
    return this.rest.post(url, request);
  }

  admin_getWithdrawals(limit) {
    let details = RestUtils.admin_getWithdrawals(this._keys.address, this._fingerprint, limit);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-get-withdrawals";
    return this.rest.post(url, request);
  }

  admin_updateWithdrawal(id, state, paymentReferenceId) {
    let details = RestUtils.admin_updateWithdrawal(this._keys.address, this._fingerprint, id, state, paymentReferenceId);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-update-withdrawal";
    return this.rest.post(url, request);
  }

  admin_setUserCuration(userId, curation) {
    let details = RestUtils.admin_setUserCuration(this._keys.address, this._fingerprint, userId, curation);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-set-user-curation";
    return this.rest.post(url, request);
  }

  admin_getPublishers() {
    let details = RestUtils.admin_getPublishers(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-publishers";
    return this.rest.post(url, request);
  }

  admin_getChannels() {
    let details = RestUtils.admin_getChannels(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-channels";
    return this.rest.post(url, request);
  }

  admin_getComments() {
    let details = RestUtils.admin_getComments(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-get-comments";
    return this.rest.post(url, request);
  }

  admin_setCommentCuration(commentId, curation) {
    let details = RestUtils.admin_setCommentCuration(this._keys.address, this._fingerprint, commentId, curation);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-set-comment-curation";
    return this.rest.post(url, request);
  }

  admin_getRealtimeStats() {
    let details = RestUtils.admin_getRealtimeStats(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-realtime-stats";
    return this.rest.post(url, request);
  }

  admin_getDeposits() {
    let details = RestUtils.admin_getDeposits(this._keys.address, this._fingerprint);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-get-deposits";
    return this.rest.post(url, request);
  }

  admin_bankDeposit(fromHandle, amount, currency, net, paypalReference) {
    let details = RestUtils.admin_bankDeposit(this._keys.address, this._fingerprint, fromHandle, amount, currency, net, paypalReference);
    let request = this._createRequest(details);
    const url = this.restBase + "/admin-bank-deposit";
    return this.rest.post(url, request);
  }

  get languages() {
    const result = {};
    result.ar = "Arabic";
    result.hy = "Armenian";
    result.zh = "Chinese";
    result.cs = "Czech";
    result.da = "Danish";
    result.nl = "Dutch";
    result.en = "English";
    result.eo = "Esperanto";
    result.fi = "Finnish";
    result.fr = "French";
    result.ka = "Georgian";
    result.de = "German";
    result.el = "Greek";
    result.hi = "Hindi";
    result.id = "Indonesian";
    result.it = "Italian";
    result.ja = "Japanese";
    result.ko = "Korean";
    result.ku = "Kurdish";
    result.fa = "Persian";
    result.pl = "Polish";
    result.pt = "Portuguese";
    result.ro = "Romanian";
    result.ru = "Russian";
    result.es = "Spanish";
    result.sv = "Swedish";
    result.tr = "Turkish";
    result.ur = "Urdu";
    result.other = "Other";
    return result;
  }
}
window.customElements.define(CoreService.is, CoreService);