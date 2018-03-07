import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, CardRecord, BankTransactionReason, BankCouponDetails, CardStatistic, UserIdentity, UserCardInfoRecord, CardPromotionBin, NetworkCardStatsHistoryRecord, NetworkCardStats, AdSlotRecord, AdSlotType, ChannelRecord, ChannelCardRecord } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { RestRequest, PostCardDetails, PostCardResponse, GetFeedsDetails, GetFeedsResponse, CardDescriptor, CardFeedSet, RequestedFeedDescriptor, BankTransactionDetails, SearchTopicDetails, SearchTopicResponse, ListTopicsDetails, ListTopicsResponse, AdminGetCardsDetails, AdminCardInfo, AdminGetCardsResponse, SearchCardResults, GetHomePageDetails, GetHomePageResponse, ChannelDescriptor, ChannelInfoWithCards, ChannelCardPinInfo } from "./interfaces/rest-services";
import { cardManager } from "./card-manager";
import { FeedHandler, socketServer } from "./socket-server";
import { Initializable } from "./interfaces/initializable";
import { userManager } from "./user-manager";
import { KeyUtils, KeyInfo } from "./key-utils";
import * as uuid from "uuid";
import { SignedObject } from "./interfaces/signed-object";
import { bank } from "./bank";
import { networkEntity } from "./network-entity";
import { SERVER_VERSION } from "./server-version";
import * as LRU from 'lru-cache';
import * as path from "path";
import * as fs from 'fs';
import { Cursor } from "mongodb";
import { channelsComponentManager } from "./channels-component-manager";
import { Utils, RangeValue } from "./utils";
import { channelManager } from "./channel-manager";
import { errorManager } from "./error-manager";

const POLLING_INTERVAL = 1000 * 15;

const SCORE_CARD_WEIGHT_AGE = 1.5;
const SCORE_CARD_AGE_HALF_LIFE = 1000 * 60 * 60 * 6;
const SCORE_CARD_WEIGHT_REVENUE = 1;
const SCORE_CARD_REVENUE_DOUBLING = 100;
const SCORE_CARD_REVENUE_RECENT_INTERVAL = 1000 * 60 * 60 * 48;
const SCORE_CARD_WEIGHT_RECENT_REVENUE = 1;
const SCORE_CARD_RECENT_REVENUE_DOUBLING = 10;
const SCORE_CARD_WEIGHT_OPENS = 10;
const SCORE_CARD_OPENS_DOUBLING = 250;
const SCORE_CARD_OPENS_RECENT_INTERVAL = 1000 * 60 * 60 * 48;
const SCORE_CARD_WEIGHT_RECENT_OPENS = 1;
const SCORE_CARD_RECENT_OPENS_DOUBLING = 25;
const SCORE_CARD_WEIGHT_LIKES = 5;
const SCORE_CARD_LIKES_DOUBLING = 0.1;
const SCORE_CARD_WEIGHT_CONTROVERSY = 1;
const SCORE_CARD_CONTROVERSY_DOUBLING = 10;
const SCORE_CARD_DISLIKE_MULTIPLER = 5;
const SCORE_CARD_BOOST_HALF_LIFE = 1000 * 60 * 60 * 24 * 3;

const HIGH_SCORE_CARD_CACHE_LIFE = 1000 * 60 * 3;
const HIGH_SCORE_CARD_COUNT = 100;
const CARD_SCORE_RANDOM_WEIGHT = 0.5;
const MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO = 0.05;
const MAXIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO = 0.66;
const MAX_AD_CARD_CACHE_LIFETIME = 1000 * 60 * 1;
const AD_IMPRESSION_HALF_LIFE = 1000 * 60 * 10;
const MINIMUM_AD_CARD_IMPRESSION_INTERVAL = 1000 * 60 * 10;
const MAX_DISCOUNTED_AUTHOR_CARD_SCORE = 0;
const RECOMMENDED_FEED_CARD_MAX_AGE = 1000 * 60 * 60 * 24 * 3;

const adToContentRatioByBalance: RangeValue[] = [
  { lowerBound: 0, value: 0.25 },
  { lowerBound: 1, value: 0.25 },
  { lowerBound: 2.5, value: 0.15 },
  { lowerBound: 5, value: 0 },
];

const payToOpenFractionByBalance: RangeValue[] = [
  { lowerBound: 0, value: 1 },
  { lowerBound: 1, value: 0.50 },
  { lowerBound: 2.5, value: 0.25 },
  { lowerBound: 5, value: 0 },
];

const adImpressionFractionByBalance: RangeValue[] = [
  { lowerBound: 0, value: 0 },
  { lowerBound: 1, value: 0.25 },
  { lowerBound: 2.5, value: 0.30 },
  { lowerBound: 5, value: 0.35 },
];

const contentImpressionFractionByBalance: RangeValue[] = [
  { lowerBound: 0, value: 0 },
  { lowerBound: 1, value: 0.25 },
  { lowerBound: 2.5, value: 0.45 },
  { lowerBound: 5, value: 0.65 },
];

export class FeedManager implements Initializable, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private userCardInfoCache = LRU<string, UserCardInfoRecord>({ max: 25000, maxAge: 1000 * 60 });
  private userEarnedAdCardIds = LRU<string, string[]>({ max: 5000, maxAge: 1000 * 60 * 60 });

  async initialize(urlManager: UrlManager): Promise<void> {
    this.urlManager = urlManager;
  }
  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('get-home'), (request: Request, response: Response) => {
      void this.handleGetHome(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-feeds'), (request: Request, response: Response) => {
      void this.handleGetFeeds(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('search-topic'), (request: Request, response: Response) => {
      void this.handleSearchTopic(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('list-topics'), (request: Request, response: Response) => {
      void this.handleListTopics(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-cards'), (request: Request, response: Response) => {
      void this.handleAdminGetCards(request, response);
    });
  }

  async initialize2(): Promise<void> {
    const cardCount = await db.countCards(Date.now(), 0);
    if (cardCount === 0) {
      await this.addSampleEntries();
      // await this.addPreviewCards();
    }
    await this.poll();
    setInterval(() => {
      void this.poll();
    }, POLLING_INTERVAL);
  }

  private async handleGetHome(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetHomePageDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.get-feeds", requestBody.detailsObject);
      const reply: GetHomePageResponse = {
        serverVersion: SERVER_VERSION,
        featuredChannels: [],
        subscribedContent: [],
        channels: [],
        promotedContent: [],
        newContent: []
      };
      const promises: Array<Promise<void>> = [];
      promises.push(this.populateHomeFeaturedChannels(request, user, reply.featuredChannels));
      promises.push(this.populateHomeSubscribedContent(request, user, requestBody.detailsObject.maxSubscribedCards, reply.subscribedContent));
      promises.push(this.populateHomeChannels(request, user, requestBody.detailsObject.maxCardsPerChannel, reply.channels));
      promises.push(this.populateHomeNewContent(request, user, requestBody.detailsObject.maxCardsPerChannel, reply.newContent));
      await Promise.all(promises);
      await this.populateHomePromotedContent(request, user, reply);
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetHome: Failure", request, request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async populateHomeFeaturedChannels(request: Request, user: UserRecord, featuredChannels: ChannelDescriptor[]): Promise<void> {
    const channels = await db.findFeaturedChannels("active", 10);
    for (const channel of channels) {
      featuredChannels.push(await channelManager.populateChannelDescriptor(user, channel));
    }
  }

  private async populateHomeSubscribedContent(request: Request, user: UserRecord, maxCount: number, feedCards: CardDescriptor[]): Promise<void> {
    const cards = await this.getCardDescriptorsInHomeFeed(request, user, maxCount || 10, 0, 0);
    for (const card of cards) {
      feedCards.push(card);
    }
  }

  private async populateHomeNewContent(request: Request, user: UserRecord, maxCount: number, feedCards: CardDescriptor[]): Promise<void> {
    const cursor = db.getCardsLatestNonPromoted();
    if (!maxCount) {
      maxCount = 5;
    }
    let count = 0;
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      if (this.isCardLanguageInterest(user, card)) {
        feedCards.push(await this.populateCard(request, card, null, false, null, null, user));
        if (++count >= maxCount) {
          break;
        }
      }
    }
    await cursor.close();
  }

  private async populateHomeChannels(request: Request, user: UserRecord, maxCardsPerChannel: number, channelsWithCards: ChannelInfoWithCards[]): Promise<void> {
    const channels = await db.findListedChannels("active", 10);
    for (const channel of channels) {
      const channelInfo: ChannelInfoWithCards = {
        channel: await channelManager.populateChannelDescriptor(user, channel),
        cards: await this.getCardsInHomeChannel(request, user, channel, maxCardsPerChannel)
      };
      if (channelInfo.cards.length > 0) {
        channelsWithCards.push(channelInfo);
      }
    }
  }

  private async getCardsInHomeChannel(request: Request, user: UserRecord, channel: ChannelRecord, maxCount: number): Promise<CardDescriptor[]> {
    const result: CardDescriptor[] = [];
    if (channel && channel.state === 'active') {
      let cursor = db.getChannelCardsPinnedByChannel(channel.id);
      let pinned = true;
      while (true) {
        if (!await cursor.hasNext()) {
          if (pinned) {
            await cursor.close();
            cursor = db.getChannelCardsUnpinnedByChannel(channel.id, 0);
            pinned = false;
            if (!await cursor.hasNext()) {
              break;
            }
          } else {
            break;
          }
        }
        const channelCard = await cursor.next();
        const card = await db.findCardById(channelCard.cardId, false);
        if (card) {
          if (card.curation && card.curation.block && card.createdById !== user.id) {
            continue;
          }
          if (card.private && card.createdById !== user.id) {
            continue;
          }
          if (card.pricing.openFeeUnits === 0) {
            continue;
          }
          if (!this.isCardLanguageInterest(user, card)) {
            continue;
          }
          const descriptor = await this.populateCard(request, card, { pinned: pinned, order: pinned ? channelCard.pinPriority : 0 }, false, null, channel.id, user);
          result.push(descriptor);
        }
        if (result.length >= maxCount) {
          break;
        }
      }
      await cursor.close();
    }
    return result;
  }

  private isCardLanguageInterest(user: UserRecord, card: CardRecord): boolean {
    if (!card.summary.langCode) {
      return true;
    }
    if (!user.preferredLangCodes || user.preferredLangCodes.length === 0) {
      return true;
    }
    return user.preferredLangCodes.indexOf(card.summary.langCode) >= 0;
  }

  private async populateHomePromotedContent(request: Request, user: UserRecord, reply: GetHomePageResponse): Promise<void> {
    if (user.balance >= user.targetBalance) {
      return;
    }
    const cardIds: string[] = [];
    const cards: CardDescriptor[] = [];
    for (const card of reply.subscribedContent) {
      cardIds.push(card.id);
      cards.push(card);
    }
    for (const channelInfo of reply.channels) {
      for (const card of channelInfo.cards) {
        cardIds.push(card.id);
        cards.push(card);
      }
    }
    if (cardIds.length === 0) {
      return;
    }
    const adSlotInfo = this.positionAdSlots(user, cardIds.length, false);
    if (adSlotInfo.slotCount === 0) {
      return;
    }
    const adCursor = db.findCardsByPromotionScore(this.getUserBalanceBin(user));
    const adIds: string[] = [];
    const earnedAdCardIds: string[] = [];
    while (await adCursor.hasNext()) {
      const adCard = await this.getNextAdCard(user, adIds, adCursor, earnedAdCardIds, cards, null, []);
      if (adCard) {
        const adSlot = await this.createAdSlot(adCard, user, null);
        const adDescriptor = await this.populateCard(request, adCard, null, true, adSlot.id, null, user);
        if (adDescriptor) {
          reply.promotedContent.push(adDescriptor);
        }
        if (reply.promotedContent.length >= adSlotInfo.slotCount) {
          break;
        }
      } else {
        break;
      }
    }
    await adCursor.close();
  }

  private async handleGetFeeds(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetFeedsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.get-feeds", requestBody.detailsObject);
      const reply: GetFeedsResponse = {
        serverVersion: SERVER_VERSION,
        feeds: []
      };
      const promises: Array<Promise<CardFeedSet>> = [];
      for (const requestedFeed of requestBody.detailsObject.feeds) {
        promises.push(this.getUserFeed(request, user, requestedFeed, requestBody.detailsObject.existingPromotedCardIds));
      }
      reply.feeds = await Promise.all(promises);
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetFeed: Failure", request, request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUserFeed(request: Request, user: UserRecord, feed: RequestedFeedDescriptor, existingPromotedCardIds: string[]): Promise<CardFeedSet> {
    const result: CardFeedSet = {
      type: feed.type,
      cards: [],
      moreAvailable: false
    };
    if (!feed.maxCount) {
      feed.maxCount = 50;
    }
    let batch: CardBatch;
    switch (feed.type) {
      case "recommended":
        batch = await this.getRecommendedFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds);
        break;
      case 'new':
        batch = await this.getRecentlyAddedFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds);
        break;
      case 'top-all-time':
        batch = await this.getTopFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds, 0);
        break;
      case 'top-past-week':
        batch = await this.getTopFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds, Date.now() - 1000 * 60 * 60 * 24 * 7);
        break;
      case 'top-past-month':
        batch = await this.getTopFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds, Date.now() - 1000 * 60 * 60 * 24 * 30);
        break;
      case 'mine':
        batch = await this.getRecentlyPostedFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds);
        break;
      case 'opened':
        batch = await this.getRecentlyOpenedFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds);
        break;
      case 'channel':
        batch = await this.getChannelFeed(request, user, feed.maxCount, feed.channelHandle, feed.afterCardId, existingPromotedCardIds);
        break;
      case 'subscribed':
        batch = await this.getSubscribedFeed(request, user, feed.maxCount, feed.afterCardId, existingPromotedCardIds);
        break;
      default:
        throw new Error("Unhandled feed type " + feed.type);
    }
    result.cards = batch.cards;
    result.moreAvailable = batch.moreAvailable;
    return result;
  }

  private async handleSearchTopic(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<SearchTopicDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.search-topic", requestBody.detailsObject);
      const batch = await this.performSearchTopic(request, user, requestBody.detailsObject.topic, requestBody.detailsObject.maxCount, requestBody.detailsObject.afterCardId, requestBody.detailsObject.promotedCardIds);
      const reply: SearchTopicResponse = {
        serverVersion: SERVER_VERSION,
        cards: batch.cards,
        moreAvailable: batch.moreAvailable
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleSearchTopic: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleListTopics(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ListTopicsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.list-topics", requestBody.detailsObject);
      const topicRecords = await db.listCardTopics();
      const topics: string[] = [];
      for (const record of topicRecords) {
        topics.push(record.topicWithCase);
      }
      const reply: ListTopicsResponse = {
        serverVersion: SERVER_VERSION,
        topics: topics
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleListTopics: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  // This determines how many ad slots should appear in the user's feed and where the first slot will appear
  private positionAdSlots(user: UserRecord, cardCount: number, more: boolean): AdSlotInfo {
    if (user.balance >= user.targetBalance || cardCount <= 1) {
      return { slotCount: 0, slotSeparation: 0, firstSlotIndex: 0 };
    }
    // Based on the user balance, we choose the appropriate ratio between ads and
    // content
    const adRatio = Utils.interpolateRanges(adToContentRatioByBalance, user.balance);
    const count = cardCount * adRatio;
    const slotCount = user.balance < 2.5 ? Math.ceil(count) : Math.floor(count);

    // const revenueNeedRatio = 1 - user.balance / user.targetBalance;
    // const adRatio = MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO + (MAXIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO - MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO) * revenueNeedRatio;
    // const slotCount = Math.max(Math.round(cardCount * adRatio), 1);
    const firstSlotIndex = more ? 0 : Math.round((1 / adRatio));
    const slotSeparation = Math.ceil(1 / adRatio);
    return {
      slotCount: slotCount,
      slotSeparation: slotSeparation,
      firstSlotIndex: firstSlotIndex
    };
  }

  private async mergeWithAdCards(request: Request, user: UserRecord, cards: CardDescriptor[], more: boolean, limit: number, existingPromotedCardIds: string[], channelId: string): Promise<CardBatch> {
    const amalgamated: CardDescriptor[] = [];
    let announcementAddedId: string;
    if (cards.length > 0) {
      // First we check to see if there is an announcement card that we need to show.
      const announcementCard = await db.findCardMostRecentByType("announcement");
      if (announcementCard) {
        // Check to see if the user has already opened this
        const userCardInfo = await db.findUserCardInfo(user.id, announcementCard.id);
        if (!userCardInfo || !userCardInfo.lastOpened) {
          const adSlot = await this.createAnnouncementAdSlot(announcementCard, user);
          const announcement = await this.populateCard(request, announcementCard, null, true, adSlot.id, null, user);
          amalgamated.push(announcement);
          announcementAddedId = announcementCard.id;
        }
      }
    }
    // Now we have to inject ad slots if necessary, and populate those ad slots with cards that offer
    // the user some revenue-generating potential
    const adSlots = this.positionAdSlots(user, cards.length, more);
    const adIds: string[] = [];
    if (adSlots.slotCount > 0) {
      let adCount = 0;
      let cardIndex = 0;
      let slotIndex = 0;
      let nextAdIndex = adSlots.firstSlotIndex;
      let earnedAdCardIds = this.userEarnedAdCardIds.get(user.id);
      if (!earnedAdCardIds) {
        earnedAdCardIds = [];
        this.userEarnedAdCardIds.set(user.id, earnedAdCardIds);
      }
      const adCursor = db.findCardsByPromotionScore(this.getUserBalanceBin(user));
      while ((cardIndex < cards.length && cardIndex < limit) || adCount < adSlots.slotCount) {
        let filled = false;
        if (slotIndex >= nextAdIndex) {
          const adCard = await this.getNextAdCard(user, adIds, adCursor, earnedAdCardIds, cards, announcementAddedId, existingPromotedCardIds ? existingPromotedCardIds : []);
          if (adCard) {
            const adSlot = await this.createAdSlot(adCard, user, channelId);
            const adDescriptor = await this.populateCard(request, adCard, null, true, adSlot.id, channelId, user);
            amalgamated.push(adDescriptor);
            nextAdIndex += adSlots.slotSeparation;
            adCount++;
            filled = true;
            console.log("FeedManager.mergeWithAdCards: Populating ad: ", adDescriptor.summary.title, adDescriptor.id, adCard.promotionScores);
          } else {
            adCount = adSlots.slotCount;
          }
        }
        if (!filled && cardIndex < cards.length && cardIndex < limit) {
          // If we've already included this card as an announcement, we skip it here
          if (!announcementAddedId || cards[cardIndex].id !== announcementAddedId) {
            amalgamated.push(cards[cardIndex]);
          }
          cardIndex++;
        }
        slotIndex++;
      }
      this.userEarnedAdCardIds.set(user.id, earnedAdCardIds);  // push the list back into the cache
      await adCursor.close();
      return { cards: amalgamated, moreAvailable: cards.length > limit };
    } else if (announcementAddedId) {
      for (let i = 0; i < cards.length && i < limit; i++) {
        const card = cards[i];
        if (card.id !== announcementAddedId) {
          amalgamated.push(card);
        }
      }
      return { cards: amalgamated, moreAvailable: cards.length > limit };
    } else if (cards.length <= limit) {
      return { cards: cards, moreAvailable: false };
    } else {
      return { cards: cards.splice(0, limit), moreAvailable: true };
    }
  }

  private async createAnnouncementAdSlot(card: CardRecord, user: UserRecord): Promise<AdSlotRecord> {
    const amount = card.pricing.openPayment ? card.pricing.openPayment : card.pricing.promotionFee;
    return db.insertAdSlot(user.id, user.balance, null, card.id, "announcement", card.createdById, amount);
  }

  private async createAdSlot(card: CardRecord, user: UserRecord, channelId: string): Promise<AdSlotRecord> {
    let type: AdSlotType;
    type = card.pricing.openPayment ? (card.summary.linkUrl ? "click-payment" : "open-payment") : (card.pricing.openFeeUnits ? "impression-content" : "impression-ad");
    const amount = card.pricing.openPayment ? card.pricing.openPayment : card.pricing.promotionFee;
    return db.insertAdSlot(user.id, user.balance, channelId, card.id, type, card.createdById, amount);
  }

  private async createAdSlotFromDescriptor(card: CardDescriptor, user: UserRecord, channelId: string): Promise<AdSlotRecord> {
    let type: AdSlotType;
    type = card.pricing.openFee < 0 ? (card.summary.linkUrl ? "click-payment" : "open-payment") : (card.pricing.openFeeUnits ? "impression-content" : "impression-ad");
    const amount = card.pricing.openFee < 0 ? -card.pricing.openFee : card.pricing.promotionFee;
    return db.insertAdSlot(user.id, user.balance, channelId, card.id, type, card.by.id, amount);
  }

  async getOnePromotedCardIfAppropriate(request: Request, user: UserRecord, card: CardDescriptor, channelId: string): Promise<CardDescriptor> {
    let earnedAdCardIds = this.userEarnedAdCardIds.get(user.id);
    if (!earnedAdCardIds) {
      earnedAdCardIds = [];
      this.userEarnedAdCardIds.set(user.id, earnedAdCardIds);
    }
    const adCursor = db.findCardsByPromotionScore(this.getUserBalanceBin(user));
    let adCard: CardRecord;
    while (true) {
      adCard = await this.getNextAdCard(user, [], adCursor, earnedAdCardIds, [card], null, []);
      if (adCard) {
        if (adCard.summary.iframeUrl) {
          continue;
        }
        break;
      } else {
        break;
      }
    }
    await adCursor.close();
    if (adCard) {
      const adSlot = await this.createAdSlotFromDescriptor(card, user, channelId);
      console.log("FeedManager.getOnePromotedCardIfAppropriate: Populating ad: ", adCard.summary.title, adCard.id, adCard.promotionScores);
      return this.populateCard(request, adCard, null, true, adSlot.id, channelId, user);
    } else {
      return null;
    }
  }

  private async getNextAdCard(user: UserRecord, alreadyPopulatedAdCardIds: string[], adCursor: Cursor<CardRecord>, earnedAdCardIds: string[], existingCards: CardDescriptor[], existingAnnouncementId: string, existingPromotedCardIds: string[]): Promise<CardRecord> {
    // To get the next ad card, we are going to randomly decide on a weighted basis between a pays-to-open/click ad, an impression ad, and a promoted pay-for card,
    // then we'll randomly pick one of these that is eligible.
    // If the one we choose is not eligible for some reason, we'll do it again until we find one, or we run out of steam.
    const excludedCardIds: string[] = [];
    for (const id of alreadyPopulatedAdCardIds) {
      excludedCardIds.push(id);
    }
    for (const id of existingPromotedCardIds) {
      excludedCardIds.push(id);
    }
    for (const id of earnedAdCardIds) {
      excludedCardIds.push(id);
    }
    for (const existing of existingCards) {
      excludedCardIds.push(existing.id);
    }
    if (existingAnnouncementId) {
      excludedCardIds.push(existingAnnouncementId);
    }
    let tries = 0;
    let noPayToOpens = false;
    let noImpressions = false;
    let noPromoted = false;
    const payToOpenFraction = Utils.interpolateRanges(payToOpenFractionByBalance, user.balance);
    const adImpressionFraction = Utils.interpolateRanges(adImpressionFractionByBalance, user.balance);
    // const contentImpressionFraction = Utils.interpolateRanges(contentImpressionFractionByBalance, user.balance);
    while (tries++ < 200 && (!noPayToOpens || !noImpressions || !noPromoted)) {
      const value = Math.random();
      let card: CardRecord;
      if (value < payToOpenFraction && !noPayToOpens) {
        card = await db.findRandomPayToOpenCard(user.id, excludedCardIds);
        if (!card) {
          noPayToOpens = true;
          console.warn("Feed.getNextAdCard: Found no eligible pays-to-open/click candidate");
        }
      } else if (value < (payToOpenFraction + adImpressionFraction) && !noImpressions) {
        card = await db.findRandomImpressionAdCard(user.id, excludedCardIds);
        if (!card) {
          noImpressions = true;
          console.warn("Feed.getNextAdCard: Found no eligible impression-ad candidate");
        }
      } else if (!noPromoted) {
        card = await db.findRandomPromotedCard(user.id, excludedCardIds);
        if (!card) {
          noPromoted = true;
          console.warn("Feed.getNextAdCard: Found no eligible promoted-card candidate");
        }
      }
      if (card) {
        const author = await userManager.getUser(card.createdById, false);
        if (!author || author.balance < card.pricing.openPayment + card.pricing.promotionFee) {
          // author doesn't have enough money to pay the reader
          continue;
        }
        let info = await this.getUserCardInfo(user.id, card.id, false);
        if (card.pricing.openPayment > 0 && info.userCardInfo && info.userCardInfo.earnedFromAuthor > 0) {
          // This card is not eligible because the user has already been paid to open it (based on our cache)
          earnedAdCardIds.push(card.id);
        } else if (info.userCardInfo && info.userCardInfo.lastOpened > 0) {
          // This card is not eligible because the user has already opened it (presumably when a fee was not applicable)
          earnedAdCardIds.push(card.id);
        } else if (card.pricing.openPayment === 0 && info.userCardInfo && Date.now() - info.userCardInfo.lastImpression < MINIMUM_AD_CARD_IMPRESSION_INTERVAL) {
          // This isn't eligible because it is impression-based and the user recently saw it
          continue;
        } else if (info.fromCache) {
          // We got this userInfo from cache, so it may be out of date.  Check again before committing to this
          // card
          info = await this.getUserCardInfo(user.id, card.id, true);
          if (card.pricing.openPayment > 0 && info.userCardInfo && info.userCardInfo.earnedFromAuthor > 0) {
            // Check that it is still eligible based on having been paid
            earnedAdCardIds.push(card.id);
          } else if (info.userCardInfo && info.userCardInfo.lastOpened > 0) {
            // This card is not eligible because the user has already opened it (presumably when a fee was not applicable)
            earnedAdCardIds.push(card.id);
          } else if (!info.userCardInfo || Date.now() - info.userCardInfo.lastImpression > MINIMUM_AD_CARD_IMPRESSION_INTERVAL) {
            // Check again based on a recent impression
            alreadyPopulatedAdCardIds.push(card.id);
            return card;
          }
        } else {
          // We can use it because it passes eligibility and the userCardInfo came directly from mongo
          alreadyPopulatedAdCardIds.push(card.id);
          return card;
        }
      }
    }
    console.warn("Feed.getNextAdCard: Found no available ads");
    return null;
  }

  private async getNextAdCard_original(user: UserRecord, alreadyPopulatedAdCardIds: string[], adCursor: Cursor<CardRecord>, earnedAdCardIds: string[], existingCards: CardDescriptor[], existingAnnouncementId: string, existingPromotedCardIds: string[]): Promise<CardRecord> {
    while (await adCursor.hasNext()) {
      const card = await adCursor.next();
      if (card.pricing.promotionFee === 0 && card.pricing.openPayment === 0) {
        console.log("Feed.getNextAdCard:  No more promoted cards available to inject");
        return null;  // no more promotional cards available
      }
      if (alreadyPopulatedAdCardIds.indexOf(card.id) >= 0) {
        continue;
      }
      if (existingPromotedCardIds.indexOf(card.id) >= 0) {
        continue;
      }
      if (!card.budget.available) {
        return null;
      }
      if (earnedAdCardIds.indexOf(card.id) >= 0) {
        continue;
      }
      if (card.createdById === user.id) {
        continue;
      }
      if (existingAnnouncementId && card.id === existingAnnouncementId) {
        continue;
      }
      if (!this.isCardLanguageInterest(user, card)) {
        continue;
      }
      let found = false;
      for (const existing of existingCards) {
        if (existing.id === card.id) {
          found = true;
          break;
        }
      }
      if (found) {
        continue;
      }
      const author = await userManager.getUser(card.createdById, false);
      if (!author || author.balance < card.pricing.openPayment + card.pricing.promotionFee) {
        // author doesn't have enough money to pay the reader
        continue;
      }
      let info = await this.getUserCardInfo(user.id, card.id, false);
      if (card.pricing.openPayment > 0 && info.userCardInfo && info.userCardInfo.earnedFromAuthor > 0) {
        // This card is not eligible because the user has already been paid to open it (based on our cache)
        earnedAdCardIds.push(card.id);
      } else if (info.userCardInfo && info.userCardInfo.lastOpened > 0) {
        // This card is not eligible because the user has already opened it (presumably when a fee was not applicable)
        earnedAdCardIds.push(card.id);
      } else if (info.userCardInfo && Date.now() - info.userCardInfo.lastImpression < MINIMUM_AD_CARD_IMPRESSION_INTERVAL) {
        // This isn't eligible because the user recently saw it
        continue;
      } else if (info.fromCache) {
        // We got this userInfo from cache, so it may be out of date.  Check again before committing to this
        // card
        info = await this.getUserCardInfo(user.id, card.id, true);
        if (card.pricing.openPayment > 0 && info.userCardInfo && info.userCardInfo.earnedFromAuthor > 0) {
          // Check that it is still eligible based on having been paid
          earnedAdCardIds.push(card.id);
        } else if (info.userCardInfo && info.userCardInfo.lastOpened > 0) {
          // This card is not eligible because the user has already opened it (presumably when a fee was not applicable)
          earnedAdCardIds.push(card.id);
        } else if (!info.userCardInfo || Date.now() - info.userCardInfo.lastImpression > MINIMUM_AD_CARD_IMPRESSION_INTERVAL) {
          // Check again based on a recent impression
          alreadyPopulatedAdCardIds.push(card.id);
          return card;
        }
      } else {
        // We can use it because it passes eligibility and the userCardInfo came directly from mongo
        alreadyPopulatedAdCardIds.push(card.id);
        return card;
      }
    }
    return null;
  }

  private async getUserCardInfo(userId: string, cardId: string, force: boolean): Promise<UserCardInfoRecordPlusCached> {
    const key = userId + '/' + cardId;
    const record = this.userCardInfoCache.get(key);
    const result: UserCardInfoRecordPlusCached = {
      userCardInfo: record,
      fromCache: typeof record !== 'undefined'
    };
    if (typeof record === 'undefined' || force) {
      result.userCardInfo = await db.findUserCardInfo(userId, cardId);
      result.fromCache = false;
      this.userCardInfoCache.set(key, record);
    }
    return result;
  }

  private getUserBalanceBin(user: UserRecord): CardPromotionBin {
    const ratio = user.balance / user.targetBalance;
    if (ratio >= 0.8) {
      return "a";
    }
    if (ratio >= 0.6) {
      return "b";
    }
    if (ratio >= 0.4) {
      return "c";
    }
    if (ratio >= 0.2) {
      return "b";
    }
    return "a";
  }

  private async getRecommendedFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    // The recommended feed consists of cards we think the user will be most interested in.  This can get
    // more sophisticated over time.  For now, it works by using a cached set of the cards that have
    // the highest overall scores (determined independent of any one user).  For each of these cards, we
    // adjust the scores based on factors that are specific to this user.  And we add a random variable
    // resulting in some churn across the set.  Then we take the top N based on how many were requested.
    let scoreLessThan = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        scoreLessThan = afterCard.score;
      }
    }
    const result = await this.getCardsWithHighestScores(request, user, false, limit + 1, afterCardId, scoreLessThan);
    // for (const r of result) {
    //   console.log("FeedManager.getRecommendedFeed: " + r.summary.title, r.score);
    // }
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async getCardsWithHighestScores(request: Request, user: UserRecord, ads: boolean, count: number, afterCardId: string, scoreLessThan: number): Promise<CardDescriptor[]> {
    if (!count) {
      count = 24;
    }
    // Taking one less than count from feed cards, because we want the last card on the page to always
    // be based on score for the purpose of getting subsequent cards based on score
    // const feedCards = await this.getCardsInFeed(request, user, count - 1, null, Date.now() - RECOMMENDED_FEED_CARD_MAX_AGE);
    const cards: CardRecord[] = [];
    const cardIds: string[] = [];
    // for (const feedCard of feedCards) {
    //   if (feedCard.curation && feedCard.curation.block && feedCard.createdById !== user.id) {
    //     continue;
    //   }
    //   if (feedCard.pricing.openPayment > 0 || (feedCard.pricing.promotionFee > 0 && feedCard.pricing.openFeeUnits === 0)) {
    //     continue;  // exclude cards that pay you appearing in your feed just because you subscribe to that channel
    //   }
    //   if (feedCard.stats && feedCard.stats.reports && feedCard.stats.reports.value > 0 && (!feedCard.curation || !feedCard.curation.overrideReports)) {
    //     continue;  // exclude cards that have been reported and not overridden by an admin
    //   }
    //   cardIds.push(feedCard.id);  // Never want to allow this card to show up again (based on score)
    //   if (!afterCardId) {  // Only include subscribed cards on first page of results
    //     const userCard = await db.findUserCardInfo(user.id, feedCard.id);
    //     if (!userCard || !userCard.lastOpened) {
    //       cards.push(feedCard);
    //     }
    //   }
    // }

    if (cards.length < count) {
      const authorIds: string[] = [];
      const cursor = db.getCardsByScore(user.id, ads, scoreLessThan);
      while (await cursor.hasNext()) {
        const cardByScore = await cursor.next();
        if (cardByScore.score <= 0) {
          break;
        }
        if (cardByScore.stats && cardByScore.stats.reports && cardByScore.stats.reports.value > 0 && (!cardByScore.curation || !cardByScore.curation.overrideReports)) {
          continue;  // exclude cards that have been reported and not overridden by an admin
        }
        if (!this.isCardLanguageInterest(user, cardByScore)) {
          continue;
        }
        if (cardIds.indexOf(cardByScore.id) < 0) {
          if (authorIds.indexOf(cardByScore.createdById) < 0) {  // include at most one card from any given author
            cards.push(cardByScore);
            cardIds.push(cardByScore.id);
            authorIds.push(cardByScore.createdById);
          }
        }
        if (cards.length >= count) {
          break;
        }
      }
      await cursor.close();
    }
    return this.populateCards(request, cards, null, false, null, null, user);
  }

  private async getCardDescriptorsInHomeFeed(request: Request, user: UserRecord, maxCount: number, before: number, after: number): Promise<CardDescriptor[]> {
    const channelIds = await channelManager.findSubscribedChannelIdsForUser(user, false);
    if (channelIds.length === 0) {
      return [];
    }
    const cursor = channelManager.getCardsInChannelsAll(channelIds, before, after);
    const result: CardDescriptor[] = [];
    while (await cursor.hasNext()) {
      const channelCard = await cursor.next();
      const card = await db.findCardById(channelCard.cardId, false);
      if (card) {
        if (card.curation && card.curation.block && user.id !== card.createdById) {
          continue;
        }
        if (card.private && user.id !== card.createdById) {
          continue;
        }
        result.push(await this.populateCard(request, card, null, false, null, channelCard.channelId, user));
      }
      if (result.length >= maxCount) {
        break;
      }
    }
    await cursor.close();
    return result;
  }

  // private async getCardsInFeed(request: Request, user: UserRecord, maxCount: number, before: number, since: number): Promise<CardRecord[]> {
  //   const channelIds = await channelManager.findSubscribedChannelIdsForUser(user, false);
  //   if (channelIds.length === 0) {
  //     return [];
  //   }
  //   const cursor = channelManager.getCardsInChannels(channelIds, before, since);
  //   const result: CardRecord[] = [];
  //   while (await cursor.hasNext()) {
  //     const channelCard = await cursor.next();
  //     const card = await db.findCardById(channelCard.cardId, false);
  //     if (card) {
  //       if (card.curation && card.curation.block && user.id !== card.createdById) {
  //         continue;
  //       }
  //       if (card.private && user.id !== card.createdById) {
  //         continue;
  //       }
  //       result.push(card);
  //     }
  //     if (result.length >= maxCount) {
  //       break;
  //     }
  //   }
  //   await cursor.close();
  //   return result;
  // }

  private async scoreCandidateCard(user: UserRecord, candidate: CardWithUserScore): Promise<CardWithUserScore> {
    const info = await this.getUserCardInfo(user.id, candidate.card.id, false);
    if (info.userCardInfo) {
      const since = Date.now() - info.userCardInfo.lastOpened;
      if (since < 1000 * 60 * 60 * 24) {
        candidate.fullScore = 0;
      }
    }
    candidate.fullScore += (Math.random() - 0.5) * CARD_SCORE_RANDOM_WEIGHT;
    return candidate;
  }

  private async getRecentlyAddedFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    let before = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        before = afterCard.postedAt;
      }
    }
    const cursor = await db.getAccessibleCardsByTime(before || Date.now(), 0, user.id);
    const cards: CardRecord[] = [];
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      if (this.isCardLanguageInterest(user, card)) {
        cards.push(card);
        if (cards.length > limit) {
          break;
        }
      }
    }
    await cursor.close();
    const result = await this.populateCards(request, cards, null, false, null, null, user);
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async getTopFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[], since: number): Promise<CardBatch> {
    let revenue = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        revenue = afterCard && afterCard.stats && afterCard.stats.revenue ? afterCard.stats.revenue.value : 0;
      }
    }
    const cursor = db.getCardsByRevenue(user.id, revenue, since);
    const cards: CardRecord[] = [];
    let found = revenue > 0 ? true : false;
    let more = false;
    while (await cursor.hasNext()) {
      if (cards.length > limit) {
        more = true;
        break;
      }
      const card = await cursor.next();
      if (found) {
        cards.push(card);
      } else {
        if (card.id === afterCardId) {
          found = true;
          continue; // because
        } else if (card.stats.revenue.value < revenue) {
          cards.push(card);
          found = true;
          continue; // because
        }
      }
    }
    await cursor.close();
    const result = await this.populateCards(request, cards, null, false, null, null, user);
    return this.mergeWithAdCards(request, user, result, more, limit, existingPromotedCardIds, null);
  }

  private async getRecentlyPostedFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    let before = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        before = afterCard.postedAt;
      }
    }
    const cursor = db.getCardsByUserAndTime(before || Date.now(), 0, user.id, false, false, true);
    const cards: CardRecord[] = [];
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      if (this.isCardLanguageInterest(user, card)) {
        cards.push(card);
        if (cards.length > limit) {
          break;
        }
      }
    }
    await cursor.close();
    const result = await this.populateCards(request, cards, null, false, null, null, user);
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async getChannelFeed(request: Request, user: UserRecord, limit: number, channelHandle: string, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    if (!limit) {
      limit = 24;
    }
    let before = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        before = afterCard.postedAt;
      }
    }
    const cards: CardRecord[] = [];
    const pinInfos: ChannelCardPinInfo[] = [];
    const channel = await db.findChannelByHandle(channelHandle);
    if (channel && channel.state === 'active') {
      let cursor: Cursor<ChannelCardRecord>;
      let pinned = true;
      if (afterCardId) {
        cursor = channelManager.getCardsInChannelUnpinned(channel.id, before, 0);
        pinned = false;
      } else {
        cursor = channelManager.getCardsInChannelPinned(channel.id);
      }
      while (true) {
        if (!await cursor.hasNext()) {
          if (pinned) {
            await cursor.close();
            cursor = channelManager.getCardsInChannelUnpinned(channel.id, 0, 0);
            pinned = false;
            if (!await cursor.hasNext()) {
              break;
            }
          } else {
            break;
          }
        }
        const channelCard = await cursor.next();
        const card = await db.findCardById(channelCard.cardId, false);
        if (card) {
          if (card.curation && card.curation.block && card.createdById !== user.id) {
            continue;
          }
          if (card.private && card.createdById !== user.id) {
            continue;
          }
          cards.push(card);
          pinInfos.push({ pinned: pinned, order: pinned ? channelCard.pinPriority : 0 });
        }
        if (cards.length > limit) {
          break;
        }
      }
      await cursor.close();
    }
    const result = await this.populateCards(request, cards, pinInfos, false, null, channel.id, user);
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, channel ? channel.id : null);
  }

  private async getSubscribedFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    if (!limit) {
      limit = 24;
    }
    let before = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        before = afterCard.postedAt;
      }
    }
    const channelIds = await channelManager.findSubscribedChannelIdsForUser(user, false);
    const cards: CardDescriptor[] = [];
    if (channelIds.length > 0) {
      const cursor = channelManager.getCardsInChannelsAll(channelIds, before, 0);
      while (await cursor.hasNext()) {
        const channelCard = await cursor.next();
        const card = await db.findCardById(channelCard.cardId, false);
        if (card) {
          if (card.curation && card.curation.block && user.id !== card.createdById) {
            continue;
          }
          if (card.private && user.id !== card.createdById) {
            continue;
          }
          cards.push(await this.populateCard(request, card, null, false, null, channelCard.channelId, user));
        }
        if (cards.length >= limit) {
          break;
        }
      }
      await cursor.close();
    }
    return this.mergeWithAdCards(request, user, cards, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async getRecentlyOpenedFeed(request: Request, user: UserRecord, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    let before = 0;
    if (afterCardId) {
      const afterCardInfo = await db.findUserCardInfo(user.id, afterCardId);
      if (afterCardInfo) {
        before = afterCardInfo.lastOpened;
      }
    }
    const infos = await db.findRecentCardOpens(user.id, limit + 1, before);
    const cards: CardRecord[] = [];
    for (const info of infos) {
      const card = await db.findCardById(info.cardId, false);
      if (card) {
        if (card.createdById === user.id || !card.curation || !card.curation.block) {
          cards.push(card);
        }
      }
    }
    const result = await this.populateCards(request, cards, null, false, null, null, user);
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async performSearchTopic(request: Request, user: UserRecord, topic: string, limit: number, afterCardId: string, existingPromotedCardIds: string[]): Promise<CardBatch> {
    let score = 0;
    if (afterCardId) {
      const afterCard = await db.findCardById(afterCardId, true);
      if (afterCard) {
        score = afterCard.score;
      }
    }
    const topicRecord = await db.findCardTopicByName(topic);
    if (!topicRecord) {
      const emptyResult: CardBatch = {
        cards: [],
        moreAvailable: false
      };
      return emptyResult;
    }
    const cards = await db.findCardsUsingKeywords(topicRecord.keywords, score, limit + 1, user.id);
    const result = await this.populateCards(request, cards, null, false, null, null, user);
    return this.mergeWithAdCards(request, user, result, afterCardId ? true : false, limit, existingPromotedCardIds, null);
  }

  private async populateCards(request: Request, cards: CardRecord[], pinInfos: ChannelCardPinInfo[], promoted: boolean, adSlotId: string, channelId: string, user?: UserRecord): Promise<CardDescriptor[]> {
    const promises: Array<Promise<CardDescriptor>> = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      let pinInfo: ChannelCardPinInfo;
      if (pinInfos && pinInfos.length > i) {
        pinInfo = pinInfos[i];
      }
      promises.push(cardManager.populateCardState(request, card.id, false, promoted, adSlotId, channelId, pinInfo, user));
    }
    const result = await Promise.all(promises);
    const finalResult: CardDescriptor[] = [];
    for (const r of result) {
      if (r) {
        finalResult.push(r);
      }
    }
    return finalResult;
  }

  private async populateCard(request: Request, card: CardRecord, pinInfo: ChannelCardPinInfo, promoted: boolean, adSlotId: string, sourceChannelId: string, user?: UserRecord, includeAdmin = false): Promise<CardDescriptor> {
    return cardManager.populateCardState(request, card.id, false, promoted, adSlotId, sourceChannelId, pinInfo, user, includeAdmin);
  }

  private async poll(): Promise<void> {
    await this.pollCardScoring(1000 * 60, 1000 * 60);
    await this.pollCardScoring(1000 * 60 * 5, 1000 * 60 * 2);
    await this.pollCardScoring(1000 * 60 * 15, 1000 * 60 * 5);
    await this.pollCardScoring(1000 * 60 * 60, 1000 * 60 * 30);
    await this.pollCardScoring(1000 * 60 * 60 * 3, 1000 * 60 * 60);
    await this.pollCardScoring(1000 * 60 * 60 * 24, 1000 * 60 * 60 * 3, true);
    await this.pollCardScoring(1000 * 60 * 60 * 24 * 365, 1000 * 60 * 60 * 12, true);
  }

  private async pollCardScoring(postInterval: number, scoreInterval: number, addHistory = false): Promise<void> {
    // This will find all of the cards that have were posted within the last postInterval specified
    // but have not been rescored within last scoreInterval
    const cards = await db.findCardsForScoring(Date.now() - postInterval, Date.now() - scoreInterval);
    const currentStats = await db.ensureNetworkCardStats();
    for (const card of cards) {
      await this.rescoreCard(card, addHistory);
    }
  }

  async rescoreCard(card: CardRecord, addHistory: boolean, currentStats?: NetworkCardStats): Promise<void> {
    const lockedCard = await cardManager.lockCard(card.id);
    try {
      if (lockedCard.lastScored === card.lastScored) {
        // After locking, it's clear that another processor has not already scored this one
        if (!currentStats) {
          const current = await db.ensureNetworkCardStats();
          currentStats = current.stats;
        }
        const score = await this.scoreCard(card, currentStats);
        if (card.score !== score) {
          console.log("Feed.rescoreCard: Updating card score", card.id, score, addHistory);
          await cardManager.updateCardScore(card, score);
        }
      }
    } finally {
      await cardManager.unlockCard(card);
    }
  }

  private async scoreCard(card: CardRecord, currentStats: NetworkCardStats): Promise<number> {
    const networkStats = await db.getNetworkCardStatsAt(card.postedAt);
    const author = await userManager.getUser(card.createdById, false);
    if (!author) {
      return 0;
    }
    return this.getTotalCardScore(card, currentStats, networkStats.stats, author);
  }

  private getTotalCardScore(card: CardRecord, currentStats: NetworkCardStats, networkStats: NetworkCardStats, author: UserRecord): number {
    let score = 0;
    if (card.stats && card.stats.reports && card.stats.reports.value > 0 && (!card.curation || !card.curation.overrideReports)) {
      return 0;
    }
    score += this.getCardAgeScore(card, author);
    score += this.getCardOpensScore(card, currentStats, networkStats);
    score += this.getCardLikesScore(card, currentStats, networkStats);
    score += this.getCardCurationScore(card);
    score = +(score.toFixed(5));
    if (author && author.curation) {
      score = Math.min(MAX_DISCOUNTED_AUTHOR_CARD_SCORE, score);
    }
    return score;
  }

  private getCardAgeScore(card: CardRecord, author: UserRecord): number {
    if (author && author.curation) {
      return 0;
    }
    return this.getInverseScore(SCORE_CARD_WEIGHT_AGE, Date.now() - card.postedAt, SCORE_CARD_AGE_HALF_LIFE);
  }

  private getInverseScore(weight: number, value: number, halfLife: number): number {
    return weight * Math.pow(2, - value / halfLife);
  }

  // private getCardRevenueScore(card: CardRecord): number {
  //   return this.getLogScore(SCORE_CARD_WEIGHT_REVENUE, card.stats.revenue.value, SCORE_CARD_REVENUE_DOUBLING);
  // }

  private getLogScore(weight: number, value: number, doubling: number): number {
    return weight * Math.log10(1 + 100 * value / doubling);
  }
  // private async getCardRecentRevenueScore(card: CardRecord): Promise<number> {
  //   const revenue = card.stats.revenue.value;
  //   const priorRevenue = await this.getPriorStatValue(card, "revenue", SCORE_CARD_REVENUE_RECENT_INTERVAL);
  //   const value = revenue - priorRevenue;
  //   return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_REVENUE, value, SCORE_CARD_RECENT_REVENUE_DOUBLING);
  // }

  private async getPriorStatValue(card: CardRecord, statName: string, minInterval: number): Promise<number> {
    let priorValue = 0;
    const stat = (card.stats as any)[statName] as CardStatistic;
    if (stat && stat.lastSnapshot > 0) {
      const history = await db.findCardStatsHistory(card.id, statName, 5);
      for (const item of history) {
        if (item.at < Date.now() - minInterval) {
          break;
        }
        priorValue = item.value;
      }
    }
    return priorValue;
  }
  private getCardOpensScore(card: CardRecord, currentStats: NetworkCardStats, networkStats: NetworkCardStats): number {
    // This returns a score based on what fraction of the unique opens network-wide during the period
    // since this card was posted were for this card.
    let ratio = 0;
    let delta = (currentStats.uniqueOpens || 0) + (currentStats.uniqueClicks || 0);
    if (networkStats.uniqueOpens) {
      delta = Math.max(25, delta - (networkStats.uniqueOpens || 0) - (networkStats.uniqueClicks || 0));
    }
    let count = 0;
    if (card.stats.uniqueOpens) {
      count += card.stats.uniqueOpens.value;
    }
    if (card.stats.uniqueClicks) {
      count += card.stats.uniqueClicks.value;
    }
    ratio = Math.min(count / (delta || 1), 1);
    return SCORE_CARD_WEIGHT_OPENS * ratio;
  }
  // private async getCardRecentOpensScore(card: CardRecord): Promise<number> {
  //   const opens = card.stats.opens.value;
  //   const priorOpens = await this.getPriorStatValue(card, "opens", SCORE_CARD_OPENS_RECENT_INTERVAL);
  //   const value = opens - priorOpens;
  //   return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_OPENS, value, SCORE_CARD_RECENT_OPENS_DOUBLING);
  // }
  private getCardLikesScore(card: CardRecord, currentStats: NetworkCardStats, networkStats: NetworkCardStats): number {
    // This returns a score based on what fraction of the net-likes network-wide during the period
    // since this card was posted were for this card.
    let netLikes = 0;
    if (card.stats && card.stats.likes) {
      netLikes += card.stats.likes.value;
    }
    if (card.stats && card.stats.dislikes) {
      netLikes -= SCORE_CARD_DISLIKE_MULTIPLER * card.stats.dislikes.value;
    }
    if (netLikes === 0 || networkStats.likes === 0) {
      return 0;
    }
    let delta = 3;
    if (currentStats.likes) {
      delta = currentStats.likes;
    }
    if (networkStats.likes) {
      delta = Math.max(3, delta - networkStats.likes);
    }

    const ratio = Math.min(1, netLikes / (delta || 3));
    return SCORE_CARD_WEIGHT_LIKES * ratio;
  }

  // private getCardControversyScore(card: CardRecord): number {
  //   if (card.stats.uniqueOpens.value > 0) {
  //     const likes = card.stats.likes.value / card.stats.uniqueOpens.value;
  //     const dislikes = card.stats.dislikes.value / card.stats.uniqueOpens.value;
  //     const controversy = (likes + dislikes) / (Math.abs(likes - dislikes) + 1);
  //     return this.getLogScore(SCORE_CARD_WEIGHT_CONTROVERSY, controversy, SCORE_CARD_CONTROVERSY_DOUBLING);
  //   } else {
  //     return 0;
  //   }
  // }

  private getCardCurationScore(card: CardRecord): number {
    // Curation allows admins to directly affect the scoring by boosting or bombing the score
    // for a card.  Boosts have a half-life, while bombs are permanent.
    if (!card.curation || !card.curation.boost) {
      return 0;
    }
    const now = Date.now();
    const age = now - (card.curation.boostAt || card.postedAt);
    return this.getInverseScore(card.curation.boost, age, SCORE_CARD_BOOST_HALF_LIFE);
  }
  private async addSampleEntries(): Promise<void> {
    console.log("FeedManager.addSampleEntries");
    if (configuration.get("debug.useSamples")) {
      const sampleUsersPath = path.join(__dirname, '../sample-users.json');
      let users: { [handle: string]: UserWithKeyUtils };
      console.log("FeedManager.addSampleEntries: adding users");
      if (fs.existsSync(sampleUsersPath)) {
        const sampleUsers = JSON.parse(fs.readFileSync(sampleUsersPath, 'utf8')) as SampleUser[];
        users = await this.loadSampleUsers(sampleUsers);
      }
      const sampleCardsPath = path.join(__dirname, '../sample-cards.json');
      console.log("FeedManager.addSampleEntries: adding cards");
      if (fs.existsSync(sampleCardsPath)) {
        const sampleCards = JSON.parse(fs.readFileSync(sampleCardsPath, 'utf8')) as SampleCard[];
        await this.loadSampleCards(sampleCards, users);
      }
    }
  }

  private async loadSampleUsers(users: SampleUser[]): Promise<{ [handle: string]: UserWithKeyUtils }> {
    const usersByHandle: { [handle: string]: UserWithKeyUtils } = {};
    for (const sample of users) {
      const user = await this.insertPreviewUser(sample.handle, sample.handle, sample.name, sample.imageUrl, sample.email);
      usersByHandle[sample.handle] = user;
    }
    return usersByHandle;
  }

  private async loadSampleCards(cards: SampleCard[], users: { [handle: string]: UserWithKeyUtils }): Promise<void> {
    await channelsComponentManager.ensureComponent(null, 'ChannelsNetwork/card-hello-world');
    for (const sample of cards) {
      const user = users[sample.handle];
      const cardId = uuid.v4();
      let coupon: CouponInfo;
      if (sample.impressionFee > 0) {
        coupon = await this.createPromotionCoupon(user, cardId, sample.impressionFee - sample.openPrice, 3, 25);
      } else if (sample.openPrice < 0) {
        coupon = await this.createOpenCoupon(user, cardId, -sample.openPrice, 3);
      }
      const card = await db.insertCard(user.user.id,
        user.user.address,
        null,
        null,
        null,
        null,
        null,
        sample.title,
        sample.text,
        'en',
        false,
        "ChannelsNetwork/card-hello-world",
        './icon.png',
        null, 0,
        sample.impressionFee, -sample.openPrice, sample.openFeeUnits,
        sample.impressionFee - sample.openPrice > 0 ? 5 : 0, coupon ? true : false, 0, coupon ? coupon.signedObject : null, coupon ? coupon.id : null, ["sample"], sample.text, [], false, null,
        cardId);
      await db.updateCardStats_Preview(card.id, sample.age * 1000, Math.max(sample.revenue, 0), sample.likes, sample.dislikes, sample.impressions, sample.opens);
      await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));
    }
  }

  // private async addPreviewCards(): Promise<void> {
  //   const now = Date.now();
  //   let user = await this.insertPreviewUser('nytimes', 'nytimes', 'New York Times', this.getPreviewUrl("nytimes.jpg"), null);
  //   let card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimes', 'New York Times',
  //     this.getPreviewUrl("nytimes.jpg"),
  //     this.getPreviewUrl("puerto_rico.jpg"), 1024, 683,
  //     null,
  //     "The Devastation in Puerto Rico, as Seen From Above",
  //     "Last week, Hurricane Maria made landfall in Puerto Rico with winds of 155 miles an hour, leaving the United States commonwealth on the brink of a humanitarian crisis. The storm left 80 percent of crop value destroyed, 60 percent of the island without water and almost the entire island without power.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-news.png"),
  //     null, 0,
  //     0, 0, 5,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 25, 30.33, 10, 31, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('80sgames', '80sgames', "80's Games", this.getPreviewUrl("80s_games.png"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, '80sgames', "80's Games",
  //     this.getPreviewUrl("80s_games.png"),
  //     this.getPreviewUrl("galaga.png"), 1332, 998,
  //     null,
  //     "Play Galaga",
  //     "The online classic 80's arcade game",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-game.png"),
  //     null, 0,
  //     0, 0, 1,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 4.67, 16, 3, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('thrillist', 'thrillist', "Thrillist", this.getPreviewUrl("thrillist.jpg"), null);
  //   const cardId1 = uuid.v4();
  //   const couponPromo1 = await this.createPromotionCoupon(user, cardId1, 0.01, 1, 15);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'thrillist', 'Thrillist',
  //     this.getPreviewUrl("thrillist.jpg"),
  //     this.getPreviewUrl("pizza_ring.jpg"), 640, 640,
  //     null,
  //     "Puff Pizza Ring",
  //     "Learn how to make this delicious treat",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-play2.png"),
  //     null, 0,
  //     0.01, 0, 3,
  //     5, 15, couponPromo1.signedObject, couponPromo1.id,
  //     null,
  //     cardId1);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 15, 3516.84, 4521, 25, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('jmodell', 'jmodell', "Josh Modell", this.getPreviewUrl("josh_modell.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'jmodell', 'Josh Modell',
  //     this.getPreviewUrl("josh_modell.jpg"),
  //     this.getPreviewUrl("the_national.png"), 800, 532,
  //     null,
  //     "The National doesn't rest on the excellent Sleep Well Beast",
  //     "Albums by The National are like your friendly neighborhood lush: In just an hour or so, they’re able to drink you under the table, say something profound enough to make the whole bar weep, then stumble out into the pre-dawn, proud and ashamed in equal measure.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-news.png"),
  //     null, 0,
  //     0, 0, 2,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3, 36.90, 342, 5, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('nytimescw', 'nytimescw', "NY Times Crosswords", this.getPreviewUrl("nytimes.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimescw', 'NY Times Crosswords',
  //     this.getPreviewUrl("nytimes.jpg"),
  //     this.getPreviewUrl("crossword1.jpg"), 640, 480,
  //     null,
  //     "Solemn Promise",
  //     "Solve this mini-crossword in one minute",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-crossword.png"),
  //     null, 0,
  //     0, 0, 2,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 6, 84.04, 251, 2, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('cbs', 'cbs', "CBS", this.getPreviewUrl("cbs.jpg"), null);
  //   const cardId2 = uuid.v4();
  //   const couponOpen2 = await this.createOpenCoupon(user, cardId2, 1.00, 10);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'cbs', 'CBS',
  //     this.getPreviewUrl("cbs.jpg"),
  //     this.getPreviewUrl("tomb_raider.jpg"), 545, 331,
  //     null,
  //     "Tomb Raider",
  //     "Alicia Vikander is Lara Croft.  Coming soon in 3D.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-play2.png"),
  //     null, 0,
  //     0, 1, 0,
  //     10, 0, couponOpen2.signedObject, couponOpen2.id,
  //     null,
  //     cardId2);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 4, 0, 34251, 245, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('tyler', 'tyler', "Tyler McGrath", this.getPreviewUrl("tyler.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'tyler', 'Tyler McGrath',
  //     this.getPreviewUrl("tyler.jpg"),
  //     this.getPreviewUrl("ascension.jpg"), 1280, 532,
  //     null,
  //     "Ascension",
  //     "An emerging life form must respond to the unstable and unforgiving terrain of a new home.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-play2.png"),
  //     null, 0,
  //     0, 0, 8,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 278.33, 342, 21, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('roadw', 'roadw', "Road Warrior", this.getPreviewUrl("road-warrior.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'roadw', 'Road Warrior',
  //     this.getPreviewUrl("road-warrior.jpg"),
  //     this.getPreviewUrl("dangerous_road.png"), 917, 481,
  //     null,
  //     "My Drive on the Most Dangerous Road in the World",
  //     null,
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-play2.png"),
  //     null, 0,
  //     0, 0, 2,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 8, 77.76, 24, 11, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('brightside', 'brightside', "Bright Side", this.getPreviewUrl("brightside.png"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'brightside', 'Bright Side',
  //     this.getPreviewUrl("brightside.png"),
  //     this.getPreviewUrl("amsterdam.jpg"), 1000, 1413,
  //     null,
  //     "The 100 best photographs ever taken without photoshop",
  //     "According to BrightSide.me",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-photos.png"),
  //     null, 0,
  //     0, 0, 3,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 5, 596.67, 76, 3, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('aperrotta', 'aperrotta', "Anthony Perrotta", this.getPreviewUrl("anthony.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'aperrotta', 'Anthony Perrotta',
  //     this.getPreviewUrl("anthony.jpg"),
  //     this.getPreviewUrl("rage_cover.jpg"), 400, 600,
  //     null,
  //     "Rage Against the Current",
  //     "It was late August and on the spur of the moment, Joseph and Gomez decided to go to the beach. They had already taken a few bowl hits in the car and now intended on topping that off with the six-pack they were lugging with them across the boardwalk, which looked out over the southern shore of Long Island. Although there was still a few hours of sunlight left, you could already catch a golden glimmer of light bouncing off the ocean's surface, as the water whittled away, little by little, at the sandy earth.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-book.png"),
  //     null, 0,
  //     0, 0, 6,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 262.65, 99, 21, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('uhaque', 'uhaque', "Umair Haque", this.getPreviewUrl("umair.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'uhaque', 'Umair Haque',
  //     this.getPreviewUrl("umair.jpg"),
  //     this.getPreviewUrl("uber_explosion.jpg"), 1200, 779,
  //     null,
  //     "Five Things to Learn From Uber's Implosion",
  //     "How to Fail at the Future",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-news.png"),
  //     null, 0,
  //     0, 0, 2,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3.5, 22.08, 15, 18, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('bluenile', 'bluenile', "Blue Nile", this.getPreviewUrl("blue_nile.jpg"), null);
  //   const cardId3 = uuid.v4();
  //   const couponPromo3 = await this.createPromotionCoupon(user, cardId3, 0.03, 8, 0);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'bluenile', 'Blue Nile',
  //     this.getPreviewUrl("blue_nile.jpg"),
  //     this.getPreviewUrl("blue_nile_diamonds.jpg"), 491, 466,
  //     "https://www.bluenile.com",
  //     "New. Brilliant. Astor by Blue Nile",
  //     "Find the most beautiful diamonds in the world and build your own ring.",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-link.png"),
  //     null, 0,
  //     0.03, 0, 0,
  //     8, 0, couponPromo3.signedObject, couponPromo3.id,
  //     null,
  //     cardId3);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 0, 78, 3, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('jigsaw', 'jigsaw', "Jigsaw", this.getPreviewUrl("jigsaw.jpg"), null);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'jigsaw', 'Jigsaw',
  //     this.getPreviewUrl("jigsaw.jpg"),
  //     this.getPreviewUrl("unfiltered_news.jpg"), 1001, 571,
  //     null,
  //     "The Latest Unfiltered News",
  //     "Explore news from around the world that are outside the mainstream media",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-touch.png"),
  //     null, 0,
  //     0, 0, 4,
  //     0, 0, null, null);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 7.5, 576.25, 44, 7, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));

  //   user = await this.insertPreviewUser('pyro', 'pyro', "Pyro Podcast", this.getPreviewUrl("podcast_handle.jpg"), null);
  //   const cardId4 = uuid.v4();
  //   const couponPromo4 = await this.createPromotionCoupon(user, cardId4, 0.01, 2, 10);
  //   card = await db.insertCard(user.user.id, user.keyInfo.address, 'pyro', 'Pyro Podcast',
  //     this.getPreviewUrl("podcast_handle.jpg"),
  //     this.getPreviewUrl("football_podcast.jpg"), 985, 554,
  //     null,
  //     "Pyro Podcast Show 285",
  //     "Foreshadowing Week 4",
  //     false,
  //     null,
  //     this.getPreviewUrl("icon-audio.png"),
  //     null, 0,
  //     0.01, 0, 5,
  //     3, 10, couponPromo4.signedObject, couponPromo4.id,
  //     null,
  //     cardId4);
  //   await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 2, 201.24, 99, 4, 0, 0);
  //   await db.updateCardPromotionScores(card, cardManager.getPromotionScores(card));
  // }

  private async createPromotionCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number, budgetPlusPercent: number): Promise<CouponInfo> {
    return this.createCoupon(user, cardId, amount, budgetAmount, budgetAmount, "card-promotion");
  }

  private async createOpenCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number): Promise<CouponInfo> {
    return this.createCoupon(user, cardId, amount, budgetAmount, 0, "card-open-payment");
  }

  private async createClickCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number): Promise<CouponInfo> {
    return this.createCoupon(user, cardId, amount, budgetAmount, 0, "card-click-payment");
  }

  private async createCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number, budgetPlusPercent: number, reason: BankTransactionReason): Promise<CouponInfo> {
    const details: BankCouponDetails = {
      address: user.user.address,
      fingerprint: null,
      timestamp: Date.now(),
      reason: reason,
      amount: amount,
      budget: {
        amount: budgetAmount,
        plusPercent: budgetPlusPercent
      }
    };
    const detailsString = JSON.stringify(details);
    const signed: SignedObject = {
      objectString: detailsString,
      signature: KeyUtils.signString(detailsString, user.keyInfo),
    };
    const couponRecord = await bank.registerCoupon(user.user, cardId, signed);
    return {
      signedObject: signed,
      id: couponRecord.id
    };
  }

  private async insertPreviewUser(id: string, handle: string, name: string, imageUrl: string, emailAddress: string): Promise<UserWithKeyUtils> {
    const privateKey = KeyUtils.generatePrivateKey();
    const keyInfo = KeyUtils.getKeyInfo(privateKey);
    const inviteCode = await userManager.generateInviteCode();
    const identity: UserIdentity = {
      name: name,
      handle: handle,
      imageId: null,
      emailAddress: emailAddress,
      emailConfirmed: false,
      emailConfirmationCode: null,
      emailLastConfirmed: 0,
      location: null,
      firstName: Utils.getFirstName(name),
      lastName: Utils.getLastName(name)
    };
    const user = await db.insertUser("normal", keyInfo.address, keyInfo.publicKeyPem, null, null, inviteCode, 0, 0, 5, 5, null, null, null, null, null, null, null, null, null, id, identity);
    const grantDetails: BankTransactionDetails = {
      address: null,
      fingerprint: null,
      timestamp: null,
      type: "transfer",
      reason: "grant",
      relatedCardId: null,
      relatedCouponId: null,
      amount: 10,
      toRecipients: []
    };
    grantDetails.toRecipients.push({
      address: user.address,
      portion: "remainder",
      reason: "grant-recipient"
    });
    await networkEntity.performBankTransaction(null, grantDetails, null, true, false, null, null, null, Date.now());
    user.balance += 10;
    user.targetBalance += 10;
    return {
      user: user,
      keyInfo: keyInfo
    };
  }

  private getPreviewUrl(relative: string): string {
    return this.urlManager.getStaticUrl("preview/" + relative, true);
  }

  async searchCards(request: Request, user: UserRecord, searchString: string, skip: number, limit: number): Promise<SearchCardResults> {
    const result: SearchCardResults = {
      cards: [],
      moreAvailable: false,
      nextSkip: 0
    };
    if (limit === 0) {
      return result;
    }
    if (limit < 1 || limit > 999) {
      limit = 50;
    }
    let cardRecords: CardRecord[] = [];
    let moreAvailable = false;
    if (searchString.indexOf('\"') < 0) {
      // First try search using the provided string as a phrase
      cardRecords = await db.findCardsBySearch('"' + searchString + '"', skip, limit + 1);
      moreAvailable = cardRecords.length > limit;
      for (const card of cardRecords) {
        console.log("Feed.searchCards: phrase-based card score", (card as any).searchScore, card.summary.title, card.id);
      }
    }
    if (cardRecords.length === 0) {
      cardRecords = await db.findCardsBySearch(searchString, skip, limit + 1);
      for (const card of cardRecords) {
        console.log("Feed.searchCards: card score", (card as any).searchScore, card.summary.title, card.id);
      }
      if (cardRecords.length > 0) {
        // If lots of results, then cull based on scores, discarding scores that are a lot lower than the max
        if (cardRecords.length > 10) {
          const culledRecords: CardRecord[] = [];
          const max = (cardRecords[0] as any).searchScore as number;
          for (const cardRecord of cardRecords) {
            const score = (cardRecord as any).searchScore as number;
            if (score > max / 4) {
              culledRecords.push(cardRecord);
            } else {
              break;
            }
          }
          moreAvailable = cardRecords.length === culledRecords.length && cardRecords.length === limit;
          cardRecords = culledRecords;
        }
      }
    }
    if (moreAvailable) {
      result.moreAvailable = true;
      cardRecords = cardRecords.slice(0, limit);
      result.nextSkip = skip + limit;
    }
    result.cards = await this.populateCards(request, cardRecords, null, false, null, null, user);
    return result;
  }

  private async handleAdminGetCards(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetCardsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.admin-get-cards", requestBody.detailsObject);
      const cardRecords = await db.findCardsByTime(requestBody.detailsObject.limit);
      const infos: AdminCardInfo[] = [];
      const currentStats = await db.ensureNetworkCardStats();
      for (const record of cardRecords) {
        const descriptor = await this.populateCard(request, record, null, false, null, null, null, true);
        const networkStats = await db.getNetworkCardStatsAt(record.postedAt);
        const author = await userManager.getUser(record.createdById, true);
        infos.push({
          descriptor: descriptor,
          scoring: {
            age: this.getCardAgeScore(record, author),
            opens: this.getCardOpensScore(record, currentStats.stats, networkStats.stats),
            likes: this.getCardLikesScore(record, currentStats.stats, networkStats.stats),
            boost: this.getCardCurationScore(record),
            total: this.getTotalCardScore(record, currentStats.stats, networkStats.stats, author)
          }
        });
      }
      const reply: AdminGetCardsResponse = {
        serverVersion: SERVER_VERSION,
        cards: infos
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminGetCards: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

}

const feedManager = new FeedManager();

export { feedManager };

export interface CardWithUserScore {
  card: CardDescriptor;
  fullScore: number;
}

export interface UserWithKeyUtils {
  user: UserRecord;
  keyInfo: KeyInfo;
}

interface CouponInfo {
  signedObject: SignedObject;
  id: string;
}

interface AdSlotInfo {
  slotCount: number;
  slotSeparation: number;
  firstSlotIndex: number;
}

interface AdCandidate {
  card: CardRecord;
  userCard: UserCardInfoRecord;
  adScore: number;
}

interface UserAdInfo {
  paidCardIds: string[];
}

interface UserCardInfoRecordPlusCached {
  userCardInfo: UserCardInfoRecord;
  fromCache: boolean;
}

interface SampleUser {
  handle: string;
  name: string;
  email: string;
  imageUrl: string;
}

interface SampleCard {
  handle: string;
  title: string;
  text: string;
  age: number;
  impressionFee: number;
  openFeeUnits: number;
  openPrice: number;
  revenue: number;
  impressions: number;
  opens: number;
  likes: number;
  dislikes: number;
}

interface CardBatch {
  cards: CardDescriptor[];
  moreAvailable: boolean;
}

interface CardWithChannel {
  card: CardDescriptor;
  channelId: string;
}
