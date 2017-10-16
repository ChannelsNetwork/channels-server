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
            resolve(JSON.parse(request.responseText));
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

  static registerUserDetails(address, publicKey, inviteCode) {
    return {
      publicKey: publicKey,
      inviteCode: inviteCode,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static registerDeviceDetails(address, deviceToken) {
    return {
      token: deviceToken,
      type: "web",
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static accountStatusDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getSyncCodeDetails(address) {
    return {
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static syncIdentityDetails(address, handle, syncCode) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      handle: handle,
      syncCode: syncCode
    };
  }

  static updateIdentityDetails(address, name, handle, location, imageUrl, emailAddress) {
    return {
      name: name,
      handle: handle,
      location: location,
      imageUrl: imageUrl,
      emailAddress: emailAddress,
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

  static checkHandleDetails(address, handle) {
    return {
      handle: handle,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static EnsureChannelComponentDetails(address, packageName) {
    return {
      package: packageName,
      address: address,
      timestamp: RestUtils.now()
    };
  }

  static getFeedDetails(address, maxCount, type) {  // type = "recommended" | "new" | "mine" | "opened"  OR null for all categories
    const feeds = [];
    if (type) {
      feeds.push({ type: type, maxCount: maxCount });
    } else {
      feeds.push({ type: 'recommended', maxCount: maxCount });
      feeds.push({ type: 'new', maxCount: maxCount });
      feeds.push({ type: 'mine', maxCount: maxCount });
      feeds.push({ type: 'opened', maxCount: maxCount });
    }
    return {
      address: address,
      timestamp: RestUtils.now(),
      feeds: feeds
    };
  }

  static ensureComponentDetails(address, packageName) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      package: packageName                 // e.g., "ChannelsNetwork/card-hello-world"
    };
  }

  static getCardDetails(address, cardId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static postCardDetails(address, imageUrl, linkUrl, title, text, packageName, packageIconUrl, promotionFee, openPayment, openFeeUnits, budgetAmount, budgetPlusPercent, coupon, initialState) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      imageUrl: imageUrl,
      linkUrl: linkUrl,
      title: title,
      text: text,
      cardType: packageName,            // same as sent to ensure-component
      cardTypeIconUrl: packageIconUrl,  // from card definition
      promotionFee: promotionFee,
      openPayment: openPayment,         // only for ads
      openFeeUnits: openFeeUnits,       // 1..10
      budgetAmount: budgetAmount,
      budgetPlusPercent: budgetPlusPercent,
      coupon: coupon,                   // signed BankCouponDetails
      state: initialState               // { user: {properties: {...}, collections: {...}}, shared: {properties: {...}, collections: {...}}}
    };
  }

  static cardImpressionDetails(address, cardId, couponId) {
    const result = {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
    if (couponId) {
      result.couponId = couponId;
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

  static cardRedeemOpenDetails(address, cardId, couponId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      cardId: cardId,
      couponId: couponId
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

  static bankTransaction(address, type, reason, cardId, couponId, amount, recipients) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      type: type,                 // "transfer"
      reason: reason,             // "card-promotion" | "card-open"
      relatedCardId: cardId,
      amount: amount,             // ChannelCoins
      toRecipients: recipients    // bankTransactionRecipient[]
    };
  }

  static bankTransactionRecipient(address, portion, amount) {
    return {
      address: address,
      portion: portion,    // "remainder" | "fraction" | "absolute"
      amount: amount       // null | 0..1 | amount
    };
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
}