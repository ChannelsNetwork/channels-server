class RestService {
  post(url, object) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.withCredentials = true;
      request.open("POST", url);
      request.setRequestHeader("Content-Type", 'application/json');
      request.onload = () => {
        const status = request.status;
        if (status === 0 || status >= 400) {
          if (request.responseText) {
            this.onError(reject, status, request.responseText);
          } else {
            this.onError(reject, status, 'Request failed with code: ' + status);
          }
        } else {
          if (request.responseText) {
            const result = JSON.parse(request.responseText);
            if (result.serverVersion) {
              if (this._lastServerVersion && this._lastServerVersion !== result.serverVersion) {
                const oldVersion = this._lastServerVersion;
                this._lastServerVersion = result.serverVersion;
                var versionChangeEvent = new CustomEvent('channels-server-version-change', { bubbles: true, composed: true, detail: { oldVersion: oldVersion, newVersion: result.serverVersion } });
                setTimeout(() => {
                  window.dispatchEvent(versionChangeEvent);
                }, 1);
              }
              this._lastServerVersion = result.serverVersion;
            }
            resolve(result);
          } else {
            resolve(null);
          }
        }
      };
      request.onerror = (err) => {
        this.onError(reject, 0, "There was a network error: " + err);
      };
      if (object) {
        request.send(JSON.stringify(object));
      } else {
        request.send();
      }
    });
  }

  postFile(url, formData) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.withCredentials = true;
      request.open("POST", url);
      request.onload = () => {
        const status = request.status;
        if (status === 0 || status >= 400) {
          if (request.responseText) {
            this.onError(reject, status, request.responseText);
          } else {
            this.onError(reject, status, 'Upload request failed with code: ' + status);
          }
        } else {
          if (request.responseText) {
            resolve(JSON.parse(request.responseText));
          } else {
            resolve(null);
          }
        }
      };
      request.onerror = (err) => {
        this.onError(reject, 0, "There was a network error on file upload: " + err);
      };
      request.send(formData);
    });
  }

  onError(reject, code, message) {
    const e = new Error(message);
    e.code = code;
    reject(e);
  }
}

class RestUtils {
  static now() {
    return (new Date()).getTime();
  }

  static registerUserDetails(address, publicKey, inviteCode, referrer, landingPageUrl) {
    return {
      publicKey: publicKey,
      inviteCode: inviteCode,
      address: address,
      timestamp: RestUtils.now(),
      referrer: referrer,
      landingUrl: landingPageUrl
    };
  }

  static signInDetails(handle) {
    return {
      handle: handle
    };
  }

  static accountStatusDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static requestRecoveryCodeDetails(handle, emailAddress) {
    return {
      handle: handle,
      emailAddress: emailAddress
    };
  }

  static recoverUserDetails(address, code, handle, encryptedPrivateKey) {
    return {
      code: code,
      handle: handle,
      encryptedPrivateKey: encryptedPrivateKey,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static updateIdentityDetails(address, name, handle, location, imageUrl, emailAddress, encryptedPrivateKey) {
    return {
      name: name,
      handle: handle,
      location: location,
      imageUrl: imageUrl,
      emailAddress: emailAddress,
      encryptedPrivateKey: encryptedPrivateKey,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getUserIdentityDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getHandleDetails(address, handle) {
    return {
      handle: handle,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static checkHandleDetails(address, handle) {
    return {
      handle: handle,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static ensureComponentDetails(address, packageName) {
    return {
      package: packageName,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getFeedsDetails(address, maxCount, type, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds) {  // type = "recommended" | "top" | "new" | "mine" | "opened"  OR null for all categories
    const feeds = [];
    if (type) {
      const feed = { type: type, maxCount: maxCount };
      if (channelHandle) {
        feed.channelHandle = channelHandle;
      }
      feeds.push(feed);
    } else {
      feeds.push({ type: 'recommended', maxCount: maxCount });
      feeds.push({ type: 'top', maxCount: maxCount });
      feeds.push({ type: 'new', maxCount: maxCount });
      feeds.push({ type: 'mine', maxCount: maxCount });
      feeds.push({ type: 'opened', maxCount: maxCount });
      if (channelHandle) {
        feeds.push({ type: 'opened', maxCount: maxCount, channelHandle: channelHandle });
      }
    }
    if (afterCardId) {
      for (const feed of feeds) {
        feed.afterCardId = afterCardId;
      }
    }
    return {
      address: address,
      timestamp: RestUtils.now(),
      feeds: feeds,
      startWithCardId: startWithCardId,
      existingPromotedCardIds: existingPromotedCardIds
    };
  }

  static getCardDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static postCardDetails(address, imageUrl, imageWidth, imageHeight, linkURL, title, text, isPrivate, packageName, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, keywords, searchText, fileIds, initialState) {
    const result = {
      address: address,
      timestamp: RestUtils.now(),
      imageUrl: imageUrl,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
      linkUrl: linkURL,
      title: title,
      text: text,
      private: isPrivate,
      cardType: packageName,            // same as sent to ensure-component
      pricing: {
        promotionFee: promotionFee,
        openPayment: openPayment,         // only for ads
        openFeeUnits: openFeeUnits,       // 1..10
        coupon: coupon,                   // signed BankCouponDetails  
      },
      keywords: keywords,
      searchText: searchText,
      sharedState: initialState,         // {properties: {...}, collections: {...}}
      fileIds: fileIds
    };
    if (budgetAmount || budgetPlusPercent) {
      result.pricing.budget = {
        amount: budgetAmount ? budgetAmount : 0,
        plusPercent: budgetPlusPercent ? budgetPlusPercent : 0
      };
    }
    return result;
  }

  static updateCardStateDetails(address, cardId, summary, state, keywords) {
    const result = {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
    if (summary) {
      result.summary = summary;
    }
    if (state) {
      result.state = state;
    }
    if (keywords) {
      result.keywords = keywords;
    }
    return result;
  }

  static cardStateSummary(title, text, linkURL, imageUrl, imageWidth, imageHeight) {
    return {
      title: title,
      text: text,
      linkUrl: linkURL,
      imageUrl: imageUrl,
      imageWidth: imageWidth,
      imageHeight: imageHeight
    };
  }

  static updateCardPricing(address, cardId, pricing) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      pricing: pricing
    };
  }

  static cardPricing(promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon) {
    const result = {
      promotionFee: promotionFee,
      openPayment: openPayment,
      openFeeUntis: openFeeUnits,
      budget: {
        amount: budgetAmount,
        plusPercent: budgetPlusPercent
      }
    };
    if (coupon) {
      result.coupon = coupon;
    }
    return result;
  }

  static cardImpressionDetails(address, cardId, transactionString, transactionSignature) {
    const result = {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
    };
    if (transactionString && transactionSignature) {
      result.transaction = {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      };
    }
    return result;
  }

  static cardOpenedDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static cardClickedDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static cardPayDetails(address, cardId, transactionString, transactionSignature) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    };
  }

  static cardRedeemOpenDetails(address, cardId, transactionString, transactionSignature) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    };
  }

  static updateCardPrivateDetails(address, cardId, isPrivate) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      private: isPrivate
    };
  }

  static deleteCardDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static getCouponDetails(address, reason, amount, budgetAmount, budgetPlusPercent) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      reason: reason,
      amount: amount,
      budget: {
        amount: budgetAmount,
        plusPercent: budgetPlusPercent
      }
    };
  }

  static bankTransactionWithdrawalRecipient(contact) {
    return {
      mechanism: "Paypal",
      currency: "USD",
      recipientContact: contact
    };
  }

  static bankTransaction(address, type, reason, cardId, couponId, amount, recipients, withdrawalRecipient) {
    const result = {
      address: address,
      timestamp: RestUtils.now(),
      type: type,                 // "transfer" | "coupon-redemption"
      reason: reason,             // "card-promotion" | "card-open"
      relatedCardId: cardId,
      amount: amount,             // ChannelCoins
      toRecipients: recipients    // bankTransactionRecipient[]
    };
    if (couponId) {
      result.relatedCouponId = couponId;
    }
    if (withdrawalRecipient) {
      result.withdrawalRecipient = withdrawalRecipient;
    }
    return result;
  }

  static bankTransactionRecipient(address, portion, reason, amount) {
    return {
      address: address,
      portion: portion,    // "remainder" | "fraction" | "absolute"
      reason: reason,
      amount: amount       // null | 0..1 | amount
    };
  }

  static bankStatementDetails(address, maxCount) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      maxCount: maxCount
    };
  }

  static bankWithdraw(address, transactionString, transactionSignature) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    }
  }

  static cardClosedDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static updateCardLikeDetails(address, cardId, selection) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      selection: selection    // "like" | "none" | "dislike"
    };
  }

  static cardStatsHistoryDetails(address, cardId, historyLimit) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      historyLimit: historyLimit
    };
  }

  static generateClientToken(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static clientCheckout(address, amount, nonce) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      amount: amount,
      paymentMethodNonce: nonce
    };
  }

  static search(address, searchString, skip, limit, existingPromotedCardIds) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      searchString: searchString,
      skip: skip,
      limit: limit,
      existingPromotedCardIds: existingPromotedCardIds
    };
  }

  static discardFiles(address, fileIds) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      fileIds: fileIds
    };
  }

  static admin_getUsers(address, withIdentityOnly, limit) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      withIdentityOnly: withIdentityOnly,
      limit: limit
    };
  }

  static admin_getCards(address, limit) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      limit: limit
    };
  }

  static admin_setUserMailingList(address, userId, includeInMailingList) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      userId: userId,
      mailingList: includeInMailingList
    };
  }

  static admin_updateCard(address, cardId, keywords, blocked, boost) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      keywords: keywords,
      blocked: blocked,
      boost: boost
    };
  }

  static admin_getGoals(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static admin_getWithdrawals(address, limit) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      limit: limit
    };
  }

  static admin_updateWithdrawal(address, id, state, paymentReferenceId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      id: id,
      state: state,
      paymentReferenceId: paymentReferenceId
    };
  }

  static queryPage(address, url) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      url: url
    };
  }

  static listTopicsDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static searchTopicDetails(address, topic, maxCount, afterCardId, promotedCardIds) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      topic: topic,
      maxCount: maxCount,
      afterCardId: afterCardId,
      promotedCardIds: promotedCardIds
    };
  }
}