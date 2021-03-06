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

  static registerUserDetails(address, fingerprint, publicKey, inviteCode, referrer, landingPageUrl, userAgent, landingCardId) {
    return {
      publicKey: publicKey,
      inviteCode: inviteCode,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      referrer: referrer,
      landingUrl: landingPageUrl,
      userAgent: userAgent,
      landingCardId: landingCardId
    };
  }

  static signInDetails(address, fingerprint, handleOrEmail) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      handleOrEmailAddress: handleOrEmail
    };
  }

  static accountStatusDetails(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static requestRecoveryCodeDetails(handle, emailAddress) {
    return {
      handle: handle,
      emailAddress: emailAddress
    };
  }

  static recoverUserDetails(address, fingerprint, code, handle, encryptedPrivateKey) {
    return {
      code: code,
      handle: handle,
      encryptedPrivateKey: encryptedPrivateKey,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static updateIdentityDetails(address, fingerprint, name, handle, location, imageId, emailAddress, encryptedPrivateKey) {
    return {
      name: name,
      handle: handle,
      location: location,
      imageId: imageId,
      emailAddress: emailAddress,
      encryptedPrivateKey: encryptedPrivateKey,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static getUserIdentityDetails(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static getHandleDetails(address, fingerprint, handle) {
    return {
      handle: handle,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static checkHandleDetails(address, fingerprint, handle) {
    return {
      handle: handle,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static ensureComponentDetails(address, fingerprint, packageName) {
    return {
      package: packageName,
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static getTopFeedsDetails(address, fingerprint, maxCount) {
    const feeds = [];
    feeds.push({ type: 'top-all-time', maxCount: maxCount });
    feeds.push({ type: 'top-past-week', maxCount: maxCount });
    feeds.push({ type: 'top-past-month', maxCount: maxCount });
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      feeds: feeds
    };
  }

  static getFeedsDetails(address, fingerprint, maxCount, type, startWithCardId, afterCardId, channelHandle, existingPromotedCardIds) {  // type = "recommended" | "top" | "new" | "mine" | "opened"  OR null for all categories
    const feeds = [];
    if (type) {
      const feed = { type: type, maxCount: maxCount };
      if (channelHandle) {
        feed.channelHandle = channelHandle;
      }
      feeds.push(feed);
    } else {
      feeds.push({ type: 'recommended', maxCount: maxCount });
      feeds.push({ type: 'top-all-time', maxCount: maxCount });
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
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      feeds: feeds,
      startWithCardId: startWithCardId,
      existingPromotedCardIds: existingPromotedCardIds
    };
  }

  static getCardDetails(address, fingerprint, cardId, channelIdContext, maxComments, includePromotedCards) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      channelIdContext: channelIdContext,
      maxComments: maxComments,
      includePromotedCards: includePromotedCards
    };
  }

  static postCardDetails(address, fingerprint, imageId, linkURL, iframeUrl, title, text, langCode, isPrivate, packageName, openFeeUnits, keywords, searchText, fileIds, initialState, campaignInfo) {
    const result = {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      imageId: imageId,
      linkUrl: linkURL,
      iframeUrl: iframeUrl,
      title: title,
      text: text,
      langCode: langCode,
      private: isPrivate,
      cardType: packageName,            // same as sent to ensure-component
      openFeeUnits: openFeeUnits,
      keywords: keywords,
      searchText: searchText,
      sharedState: initialState,         // {properties: {...}, collections: {...}}
      fileIds: fileIds,
      campaignInfo: campaignInfo
    };
    return result;
  }

  static cardCampaignInfo(type, budget, ends, geoTargets) {
    return {
      type: type,  // content-impression | impression-ad | pay-to-open | pay-to-click
      budget: budget,
      ends: ends,
      geoTargets: geoTargets
    };
  }

  static cardCampaignBudgetForContent(promotionTotal, plusPercent) {
    return {
      promotionTotal: promotionTotal,
      plusPercent: plusPercent
    };
  }

  static cardCampaignBudgetForAd(maxPerDay) {
    return {
      maxPerDay: maxPerDay
    };
  }

  static updateCardStateDetails(address, fingerprint, cardId, summary, state, keywords) {
    const result = {
      address: address,
      fingerprint: fingerprint,
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

  static cardStateSummary(title, text, langCode, linkURL, imageId, imageURL) {
    return {
      title: title,
      text: text,
      langCode: langCode,
      linkUrl: linkURL,
      imageId: imageId,
      imageURL: imageURL
    };
  }

  static updateCardPricing(address, fingerprint, cardId, openFeeUnits) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      openFeeUnits: openFeeUnits
    };
  }

  static cardImpressionDetails(address, fingerprint, cardId, adSlotId, transactionString, transactionSignature) {
    const result = {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      adSlotId: adSlotId
    };
    if (transactionString && transactionSignature) {
      result.transaction = {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      };
    }
    return result;
  }

  static cardOpenedDetails(address, fingerprint, cardId, adSlotId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      adSlotId: adSlotId
    };
  }

  static cardClickedDetails(address, fingerprint, cardId, adSlotId, transactionString, transactionSignature) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      adSlotId: adSlotId,
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    };
  }

  static cardPayDetails(address, fingerprint, cardId, transactionString, transactionSignature, mobile) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      },
      mobile: mobile
    };
  }

  static cardRedeemOpenDetails(address, fingerprint, cardId, adSlotId, transactionString, transactionSignature) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      adSlotId: adSlotId,
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    };
  }

  static updateCardPrivateDetails(address, fingerprint, cardId, isPrivate) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      private: isPrivate
    };
  }

  static deleteCardDetails(address, fingerprint, cardId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static getCouponDetails(address, fingerprint, reason, amount, budgetAmount, budgetPlusPercent) {
    return {
      address: address,
      fingerprint: fingerprint,
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

  static bankTransaction(address, fingerprint, type, reason, cardId, couponId, amount, recipients, withdrawalRecipient) {
    const result = {
      address: address,
      fingerprint: fingerprint,
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

  static bankStatementDetails(address, fingerprint, maxCount) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      maxCount: maxCount
    };
  }

  static bankWithdraw(address, fingerprint, transactionString, transactionSignature) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      transaction: {
        objectString: transactionString,  // serialized bankTransaction
        signature: transactionSignature
      }
    }
  }

  static cardClosedDetails(address, fingerprint, cardId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId
    };
  }

  static updateCardLikeDetails(address, fingerprint, cardId, selection) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      selection: selection    // "like" | "none" | "dislike"
    };
  }

  static cardStatsHistoryDetails(address, fingerprint, cardId, historyLimit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      historyLimit: historyLimit
    };
  }

  static generateClientToken(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static clientCheckout(address, fingerprint, amount, nonce) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      amount: amount,
      paymentMethodNonce: nonce
    };
  }

  static search(address, fingerprint, searchString, limitCards, limitChannels) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      searchString: searchString,
      limitCards: limitCards,
      limitChannels: limitChannels
    };
  }

  static searchMoreCards(address, fingerprint, searchString, skip, limit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      searchString: searchString,
      skip: skip,
      limit: limit
    };
  }

  static searchMoreChannels(address, fingerprint, searchString, skip, limit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      searchString: searchString,
      skip: skip,
      limit: limit
    };
  }

  static discardFiles(address, fingerprint, fileIds) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      fileIds: fileIds
    };
  }

  static admin_getUsers(address, fingerprint, withIdentityOnly, limit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      withIdentityOnly: withIdentityOnly,
      limit: limit
    };
  }

  static admin_getCards(address, fingerprint, limit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      limit: limit
    };
  }

  static admin_setUserMailingList(address, fingerprint, userId, includeInMailingList) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      userId: userId,
      mailingList: includeInMailingList
    };
  }

  static admin_updateCard(address, fingerprint, cardId, keywords, blocked, boost, overrideReports) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      keywords: keywords,
      blocked: blocked,
      boost: boost,
      overrideReports: overrideReports
    };
  }

  static admin_updateChannel(address, fingerprint, channelId, featuredWeight, listingWeight) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      featuredWeight: featuredWeight,
      listingWeight: listingWeight
    };
  }

  static admin_getGoals(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_getWithdrawals(address, fingerprint, limit) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      limit: limit
    };
  }

  static admin_updateWithdrawal(address, fingerprint, id, state, paymentReferenceId) {
    return {
      address: address,
      timestamp: RestUtils.now(),
      id: id,
      state: state,
      paymentReferenceId: paymentReferenceId
    };
  }

  static admin_setUserCuration(address, fingerprint, userId, curation) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      userId: userId,
      curation: curation
    };
  }

  static admin_getPublishers(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_getChannels(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_getComments(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_setCommentCuration(address, fingerprint, commentId, curation) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      commentId: commentId,
      curation: curation
    };
  }

  static admin_getRealtimeStats(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_getDeposits(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_bankDeposit(address, fingerprint, fromHandle, amount, currency, net, paypalReference) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      fromHandle: fromHandle,
      amount: amount,
      currency: currency,
      net: net,
      paypalReference: paypalReference
    };
  }

  static admin_curateCardQuality(address, fingerprint, cardId, quality, market) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      quality: quality,
      market: market
    };
  }

  static admin_getCardCampaigns(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_getReferrals(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static admin_payCardBonus(address, fingerprint, cardId, amount) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      amount: amount
    };
  }

  static queryPage(address, fingerprint, url) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      url: url
    };
  }

  static listTopicsDetails(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static searchTopicDetails(address, fingerprint, topic, maxCount, afterCardId, promotedCardIds) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      topic: topic,
      maxCount: maxCount,
      afterCardId: afterCardId,
      promotedCardIds: promotedCardIds
    };
  }

  static getChannelDetails(address, fingerprint, channelId, ownerId, ownerHandle, channelHandle) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      ownerId: ownerId,
      ownerHandle: ownerHandle,
      channelHandle: channelHandle
    };
  }

  static getChannelsDetails(address, fingerprint, type, maxChannels, nextPageRef) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      type: type,
      maxChannels: maxChannels,
      nextPageReference: nextPageRef
    };
  }

  static updateChannelDetails(address, fingerprint, channelId, name, bannerImageFileId, about, link, socialLinks) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      name: name,
      bannerImageFileId: bannerImageFileId,
      about: about,
      link: link,
      socialLinks: socialLinks
    };
  }

  static updateChannelSubscriptionDetails(address, fingerprint, channelId, state) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      subscriptionState: state
    };
  }

  static reportChannelVisitDetails(address, fingerprint, channelId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId
    };
  }

  static requestEmailConfirmationDetails(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now()
    };
  }

  static confirmEmailDetails(address, fingerprint, code) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      code: code
    };
  }

  static updateAccountSettingsDetails(address, fingerprint, settings) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      settings: settings
    };
  }

  static accountSettings(disallowPlatformNotifications, disallowContentNotifications, preferredlangCodes) {
    return {
      disallowPlatformNotifications: disallowPlatformNotifications ? true : false,
      disallowContentNotifications: disallowContentNotifications ? true : false,
      preferredlangCodes: preferredLangCodes
    };
  }

  static reportCardDetails(address, fingerprint, cardId, reasons, comment, requestRefund, adminBlockCard, adminBlockUser) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      reasons: reasons,
      comment: comment,
      requestRefund: requestRefund,
      adminBlockCard: adminBlockCard,
      adminBlockUser: adminBlockUser
    };
  }

  static getHome(address, fingerprint, maxSubscribedCards, maxCardsPerChannel) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      maxSubscribedCards: maxSubscribedCards,
      maxCardsPerChannel: maxCardsPerChannel
    };
  }

  static getChannelCard(address, fingerprint, channelId, cardId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      cardId: cardId
    };
  }

  static updateChannelCard(address, fingerprint, channelId, cardId, includeInChannel) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      cardId: cardId,
      includeInChannel: includeInChannel
    };
  }

  static postCardComment(address, fingerprint, cardId, text, metadata) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      text: text,
      metadata: metadata
    };
  }

  static getCardComments(address, fingerprint, cardId, before, maxCount) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      before: before,
      maxCount: maxCount
    };
  }

  static setChannelCardPinning(address, fingerprint, channelId, cardId, pinned) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      cardId: cardId,
      pinned: pinned
    };
  }

  static cardCommentMetadata(fields) {
    return {
      fields: fields
    };
  }

  static cardCommentFieldDescriptor(startOffset, length, text, type, href, handle) {
    return {
      startOffset: startOffset,
      length: length,
      text: text,  // the text representing this (such as 'channels.cc/c/...')
      type: type,  // 'hyperlink' | 'handle'
      href: href,
      handle: handle
    };
  }

  static getChannelSubscribers(address, fingerprint, channelId, maxCount, afterSubscriberId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      channelId: channelId,
      maxCount: maxCount,
      afterSubscriberId: afterSubscriberId
    };
  }

  static getCardCampaigns(address, fingerprint, maxCount, afterCampaignId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      maxCount: maxCount,
      afterCampaignId: afterCampaignId
    };
  }

  static getGeoDescriptors(address, fingerprint, countryCode) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      countryCode: countryCode
    };
  }

  static getAvailableAdSlots(address, fingerprint, geoTargets) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      geoTargets: geoTargets
    };
  }

  static updateCardCampaign(address, fingerprint, campaignId, info) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      campaignId: campaignId,
      info: info
    };
  }

  static updateCardCampaignStatus(address, fingerprint, campaignId, paused) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      campaignId: campaignId,
      paused: paused
    };
  }

  static getUserCardAnalytics(address, fingerprint, cardId, maxCount, after) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      cardId: cardId,
      maxCount: maxCount,
      after: after
    };
  }

  static shortenUrl(address, fingerprint, url) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      url: url
    };
  }

  static getUserStats(address, fingerprint) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
    };
  }

  static getCommunityInfo(address, fingerprint, maxCountPerList) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      maxCount: maxCountPerList
    };
  }

  static getCommunityInfoMore(address, fingerprint, listType, maxCount, afterUserId) {
    return {
      address: address,
      fingerprint: fingerprint,
      timestamp: RestUtils.now(),
      list: listType,
      maxCount: maxCount,
      afterUserId: afterUserId
    };
  }
}