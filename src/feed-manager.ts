import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, CardRecord, BankTransactionReason, BankCouponDetails, CardStatistic, UserIdentity, UserCardInfoRecord } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { RestRequest, PostCardDetails, PostCardResponse, GetFeedDetails, GetFeedResponse, CardDescriptor, CardFeedSet, RequestedFeedDescriptor, BankTransactionDetails } from "./interfaces/rest-services";
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

const POLLING_INTERVAL = 1000 * 15;

const SCORE_CARD_WEIGHT_AGE = 5;
const SCORE_CARD_AGE_HALF_LIFE = 1000 * 60 * 60 * 12;
const SCORE_CARD_WEIGHT_REVENUE = 2;
const SCORE_CARD_REVENUE_DOUBLING = 25;
const SCORE_CARD_REVENUE_RECENT_INTERVAL = 1000 * 60 * 60 * 12;
const SCORE_CARD_WEIGHT_RECENT_REVENUE = 4;
const SCORE_CARD_RECENT_REVENUE_DOUBLING = 5;
const SCORE_CARD_WEIGHT_OPENS = 1;
const SCORE_CARD_OPENS_DOUBLING = 500;
const SCORE_CARD_OPENS_RECENT_INTERVAL = 1000 * 60 * 60 * 12;
const SCORE_CARD_WEIGHT_RECENT_OPENS = 1;
const SCORE_CARD_RECENT_OPENS_DOUBLING = 50;
const SCORE_CARD_WEIGHT_LIKES = 8;
const SCORE_CARD_LIKES_DOUBLING = 25;
const SCORE_CARD_WEIGHT_CONTROVERSY = 6;
const SCORE_CARD_CONTROVERSY_DOUBLING = 100;

const HIGH_SCORE_CARD_CACHE_LIFE = 1000 * 60 * 3;
const HIGH_SCORE_CARD_COUNT = 100;
const CARD_SCORE_RANDOM_WEIGHT = 0.5;
const MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO = 0.05;
const MAXIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO = 1;
const MAX_AD_CARD_CACHE_LIFETIME = 1000 * 60 * 1;
const AD_IMPRESSION_HALF_LIFE = 1000 * 60 * 10;

export class FeedManager implements Initializable, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private highScoreCards: CardDescriptor[] = [];
  private lastHighScoreCardsAt = 0;

  private adCardsCache: CardRecord[] = [];
  private lastAdCardsCacheUpdated = 0;
  private userCardCache = LRU<string, UserCardInfoRecord>({ max: 20000, maxAge: 1000 * 60 * 5 });

  async initialize(urlManager: UrlManager): Promise<void> {
    this.urlManager = urlManager;
  }
  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('get-feed'), (request: Request, response: Response) => {
      void this.handleGetFeed(request, response);
    });
  }

  async initialize2(): Promise<void> {
    const cardCount = await db.countCards();
    if (cardCount === 0) {
      await this.addPreviewCards();
    }
    setInterval(() => {
      void this.poll();
    }, POLLING_INTERVAL);
  }

  private async handleGetFeed(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetFeedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("FeedManager.get-feed", requestBody.detailsObject);
      const reply: GetFeedResponse = {
        serverVersion: SERVER_VERSION,
        feeds: []
      };
      const promises: Array<Promise<CardFeedSet>> = [];
      for (const requestedFeed of requestBody.detailsObject.feeds) {
        promises.push(this.getUserFeed(user, requestedFeed, requestBody.detailsObject.startWithCardId));
      }
      reply.feeds = await Promise.all(promises);
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetFeed: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUserFeed(user: UserRecord, feed: RequestedFeedDescriptor, startWithCardId?: string): Promise<CardFeedSet> {
    const result: CardFeedSet = {
      type: feed.type,
      cards: []
    };
    switch (feed.type) {
      case "recommended":
        result.cards = await this.getRecommendedFeed(user, feed.maxCount, startWithCardId);
        break;
      case 'new':
        result.cards = await this.getRecentlyAddedFeed(user, feed.maxCount, startWithCardId);
        break;
      case 'top':
        result.cards = await this.getTopFeed(user, feed.maxCount, startWithCardId);
        break;
      case 'mine':
        result.cards = await this.getRecentlyPostedFeed(user, feed.maxCount, startWithCardId);
        break;
      case 'opened':
        result.cards = await this.getRecentlyOpenedFeed(user, feed.maxCount, startWithCardId);
        break;
      case 'channel':
        result.cards = await this.getChannelFeed(user, feed.maxCount, feed.channelHandle, startWithCardId);
        break;
      default:
        throw new Error("Unhandled feed type " + feed.type);
    }

    return result;
  }

  // This determines how many ad slots should appear in the user's feed and where the first slot will appear
  private positionAdSlots(user: UserRecord, cardCount: number): AdSlotInfo {
    if (user.balance > user.targetBalance || cardCount === 0) {
      return { slotCount: 0, slotSeparation: 0, firstSlotIndex: 0 };
    }
    const revenueNeedRatio = 1 - user.balance / user.targetBalance;
    const adRatio = MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO + (MAXIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO - MINIMUM_PROMOTED_CARD_TO_FEED_CARD_RATIO) * revenueNeedRatio;
    const slotCount = Math.max(Math.round(cardCount * adRatio), 1);
    const firstSlotIndex = Math.round((1 / adRatio) * (1 - revenueNeedRatio));
    const slotSeparation = Math.ceil(1 / adRatio);
    return {
      slotCount: slotCount,
      slotSeparation: slotSeparation,
      firstSlotIndex: firstSlotIndex
    };
  }

  // This essentially runs an auction for ad slots and picks the top N cards
  private async getAdCards(user: UserRecord, nonAdCards: CardDescriptor[]): Promise<CardRecord[]> {
    const cards = await this.getAvailableAdCards();
    const promises: Array<Promise<UserCardInfoRecord>> = [];
    const nonAdCardIds: string[] = [];
    for (const nonAdCard of nonAdCards) {
      nonAdCardIds.push(nonAdCard.id);
    }
    for (const card of cards) {
      // Exclude ad cards that are already part of the feed being returned
      if (nonAdCardIds.indexOf(card.id) < 0) {
        promises.push(this.getUserCardInfo(user.id, card.id, false));
      }
    }
    const userCardInfos = await Promise.all(promises);
    const candidates: AdCandidate[] = [];
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].budget.available && nonAdCardIds.indexOf(cards[i].id) < 0 && (!userCardInfos[i] || userCardInfos[i].earnedFromAuthor === 0)) {
        const candidate: AdCandidate = {
          card: cards[i],
          adScore: this.computeAdScore(user, cards[i], userCardInfos[i]),
          userCard: userCardInfos[i]
        };
        candidates.push(candidate);
        console.log("FeedManager.getAdCards: Ad", cards[i].summary.title, candidate.adScore);
      }
    }
    candidates.sort((a, b) => {
      return b.adScore - a.adScore;
    });
    const resultCards: CardRecord[] = [];
    for (const c of candidates) {
      resultCards.push(c.card);
    }
    return resultCards;
  }

  private async getUserCardInfo(userId: string, cardId: string, force: boolean): Promise<UserCardInfoRecord> {
    const key = userId + '/' + cardId;
    let entry = this.userCardCache.get(key);
    if (force || typeof entry === 'undefined') {
      entry = await db.findUserCardInfo(userId, cardId);
      if (!force || entry) {
        this.userCardCache.set(key, entry ? entry : null);
      }
    }
    return entry;
  }

  private async getAvailableAdCards(): Promise<CardRecord[]> {
    if (Date.now() - this.lastAdCardsCacheUpdated > MAX_AD_CARD_CACHE_LIFETIME) {
      this.adCardsCache = await db.findCardsWithAvailableBudget(2500);
    }
    return this.adCardsCache;
  }

  private computeAdScore(user: UserRecord, card: CardRecord, userCardInfo: UserCardInfoRecord): number {
    let openProbability = card.pricing.openFeeUnits > 0 ? 0.2 : 0.02;
    if (card.stats.uniqueImpressions.value > 50) {
      openProbability = Math.max(card.pricing.openFeeUnits > 0 ? 0.01 : 0.0001, card.stats.uniqueOpens.value / card.stats.uniqueImpressions.value);
    }
    const revenuePotential = card.pricing.promotionFee + card.pricing.openPayment * openProbability;
    const needRevenueRatio = 1 - user.balance / user.targetBalance;
    // We reduce the score for recently viewed cards;
    const ageFactor = userCardInfo && userCardInfo.lastImpression ? 1 - Math.pow(2, -(Date.now() - userCardInfo.lastImpression) / AD_IMPRESSION_HALF_LIFE) : 1;
    // TODO: Theoretically, the second term may need a multiplier to normalize openProbability to similar units as revenuePotential
    const score = ageFactor * (needRevenueRatio * revenuePotential + (1 - needRevenueRatio) * openProbability);
    return score;
  }

  private async mergeWithAdCards(user: UserRecord, cards: CardDescriptor[]): Promise<CardDescriptor[]> {
    // Now we have to inject ad slots if necessary, and populate those ad slots with cards that offer
    // the user some revenue-generating potential
    const adSlots = this.positionAdSlots(user, cards.length);
    if (adSlots.slotCount > 0) {
      const adCards = await this.getAdCards(user, cards);
      const maxAdCards = Math.min(adSlots.slotCount, adCards.length);
      const amalgamated: CardDescriptor[] = [];
      let adIndex = 0;
      let cardIndex = 0;
      let slotIndex = 0;
      let nextAdIndex = adSlots.firstSlotIndex;
      while (adIndex < maxAdCards || cardIndex < cards.length) {
        if (slotIndex >= nextAdIndex && adIndex < adCards.length) {
          const adDescriptor = await this.populateCard(adCards[adIndex++], true, user);
          amalgamated.push(adDescriptor);
          nextAdIndex += adSlots.slotSeparation;
          // We flush this ad from the userCard cache, because if we get an impression, we don't want
          // to depend on the cached version which won't have the impression recorded
          this.userCardCache.del(user.id + '/' + adDescriptor.id);
          console.log("FeedManager.mergeWithAdCards: Populating ad: ", adDescriptor.summary.title);
        } else if (cardIndex < cards.length) {
          amalgamated.push(cards[cardIndex++]);
        }
        slotIndex++;
      }
      return amalgamated;
    } else {
      return cards;
    }
  }

  private async getRecommendedFeed(user: UserRecord, limit: number, startWithCardId?: string): Promise<CardDescriptor[]> {
    // The recommended feed consists of cards we think the user will be most interested in.  This can get
    // more sophisticated over time.  For now, it works by using a cached set of the cards that have
    // the highest overall scores (determined independent of any one user).  For each of these cards, we
    // adjust the scores based on factors that are specific to this user.  And we add a random variable
    // resulting in some churn across the set.  Then we take the top N based on how many were requested.
    const highScores = await this.getCardsWithHighestScores(user, false, startWithCardId);
    const promises: Array<Promise<CardWithUserScore>> = [];
    for (const highScore of highScores) {
      if (user.address !== highScore.by.address) {
        const candidate: CardWithUserScore = {
          card: highScore,
          fullScore: highScore.score
        };
        promises.push(this.scoreCandidateCard(user, candidate));
      }
    }
    const candidates = await Promise.all(promises);
    candidates.sort((a, b) => {
      return b.fullScore - a.fullScore;
    });
    const result: CardDescriptor[] = [];
    for (const candidate of candidates) {
      result.push(candidate.card);
      if (result.length >= limit) {
        break;
      }
    }
    return await this.mergeWithAdCards(user, result);
  }

  private async getCardsWithHighestScores(user: UserRecord, ads: boolean, startWithCardId?: string): Promise<CardDescriptor[]> {
    const now = Date.now();
    if (now - this.lastHighScoreCardsAt < HIGH_SCORE_CARD_CACHE_LIFE) {
      return this.highScoreCards;
    }
    this.lastHighScoreCardsAt = now;
    const cards = await db.findCardsByScore(HIGH_SCORE_CARD_COUNT, user.id, ads);
    this.highScoreCards = await this.populateCards(cards, false, user, startWithCardId);
    return this.highScoreCards;
  }

  private async scoreCandidateCard(user: UserRecord, candidate: CardWithUserScore): Promise<CardWithUserScore> {
    const userCardInfo = await db.findUserCardInfo(user.id, candidate.card.id);
    if (userCardInfo) {
      const since = Date.now() - userCardInfo.lastOpened;
      if (since < 1000 * 60 * 60 * 24) {
        candidate.fullScore = 0;
      }
    }
    candidate.fullScore += (Math.random() - 0.5) * CARD_SCORE_RANDOM_WEIGHT;
    return candidate;
  }

  private async getRecentlyAddedFeed(user: UserRecord, limit: number, startWithCardId?: string): Promise<CardDescriptor[]> {
    const cards = await db.findAccessibleCardsByTime(Date.now(), 0, limit, user.id);
    const result = await this.populateCards(cards, false, user, startWithCardId);
    return await this.mergeWithAdCards(user, result);
  }

  private async getTopFeed(user: UserRecord, limit: number, startWithCardId?: string): Promise<CardDescriptor[]> {
    const cards = await db.findCardsByRevenue(limit, user.id);
    const result = await this.populateCards(cards, false, user, startWithCardId);
    return await this.mergeWithAdCards(user, result);
  }

  private async getRecentlyPostedFeed(user: UserRecord, limit: number, startWithCardId?: string): Promise<CardDescriptor[]> {
    const cards = await db.findCardsByUserAndTime(Date.now(), 0, limit, user.id, false);
    const result = await this.populateCards(cards, false, user, startWithCardId);
    return await this.mergeWithAdCards(user, result);
  }

  private async getChannelFeed(user: UserRecord, limit: number, channelHandle: string, startWithCardId?: string): Promise<CardDescriptor[]> {
    const author = await db.findUserByHandle(channelHandle);
    let cards: CardRecord[] = [];
    if (author) {
      cards = await db.findCardsByUserAndTime(Date.now(), 0, limit, author.id, true);
    }
    const result = await this.populateCards(cards, false, user, startWithCardId);
    return await this.mergeWithAdCards(user, result);
  }

  private async getRecentlyOpenedFeed(user: UserRecord, limit: number, startWithCardId?: string): Promise<CardDescriptor[]> {
    const infos = await db.findRecentCardOpens(user.id, limit);
    const cards: CardRecord[] = [];
    for (const info of infos) {
      const card = await db.findCardById(info.cardId, false);
      if (card && (!card.private || card.by.id === user.id)) {
        cards.push(card);
      }
    }
    const result = await this.populateCards(cards, false, user, startWithCardId);
    return await this.mergeWithAdCards(user, result);
  }

  private async populateCards(cards: CardRecord[], promoted: boolean, user?: UserRecord, startWithCardId?: string): Promise<CardDescriptor[]> {
    const promises: Array<Promise<CardDescriptor>> = [];
    const orderedCards: CardRecord[] = [];
    let found = false;
    for (const card of cards) {
      if (startWithCardId && card.id === startWithCardId) {
        orderedCards.unshift(card);
        found = true;
      } else {
        orderedCards.push(card);
      }
    }
    if (startWithCardId && !found) {
      const card = await db.findCardById(startWithCardId, false);
      if (card) {
        orderedCards.unshift(card);
      }
    }
    for (const card of orderedCards) {
      promises.push(cardManager.populateCardState(card.id, false, promoted, user));
    }
    const result = await Promise.all(promises);
    return result;
  }

  private async populateCard(card: CardRecord, promoted: boolean, user?: UserRecord): Promise<CardDescriptor> {
    return await cardManager.populateCardState(card.id, false, promoted, user);
  }

  private async poll(): Promise<void> {
    await this.pollCardScoring(1000 * 60, 1000 * 60);
    await this.pollCardScoring(1000 * 60 * 5, 1000 * 60 * 2);
    await this.pollCardScoring(1000 * 60 * 15, 1000 * 60 * 5);
    await this.pollCardScoring(1000 * 60 * 60, 1000 * 60 * 30);
    await this.pollCardScoring(1000 * 60 * 60 * 3, 1000 * 60 * 60);
    await this.pollCardScoring(1000 * 60 * 60 * 24, 1000 * 60 * 60 * 6, true);
    await this.pollCardScoring(1000 * 60 * 60 * 24 * 365, 1000 * 60 * 60 * 12, true);
  }

  private async pollCardScoring(postInterval: number, scoreInterval: number, addHistory = false): Promise<void> {
    // This will find all of the cards that have were posted within the last postInterval specified
    // but have not been rescored within last scoreInterval
    const cards = await db.findCardsForScoring(Date.now() - postInterval, Date.now() - scoreInterval);
    for (const card of cards) {
      await this.rescoreCard(card, addHistory);
    }
  }

  private async rescoreCard(card: CardRecord, addHistory: boolean): Promise<void> {
    const lockedCard = await cardManager.lockCard(card.id);
    try {
      if (lockedCard.lastScored === card.lastScored) {
        // After locking, it's clear that another processor has not already scored this one
        const score = await this.scoreCard(card);
        if (card.score !== score) {
          console.log("Feed.rescoreCard: Updating card score", card.id, score, addHistory);
          await cardManager.updateCardScore(card, score);
        }
      }
    } finally {
      await cardManager.unlockCard(card);
    }
  }

  private async scoreCard(card: CardRecord): Promise<number> {
    let score = 0;
    score += this.getCardAgeScore(card);
    score += this.getCardRevenueScore(card);
    score += await this.getCardRecentRevenueScore(card);
    score += this.getCardOpensScore(card);
    score += await this.getCardRecentOpensScore(card);
    score += this.getCardLikesScore(card);
    score += this.getCardControversyScore(card);
    return +(score.toFixed(5));
  }

  private getCardAgeScore(card: CardRecord): number {
    return this.getInverseScore(SCORE_CARD_WEIGHT_AGE, Date.now() - card.postedAt, SCORE_CARD_AGE_HALF_LIFE);
  }

  private getInverseScore(weight: number, value: number, halfLife: number): number {
    return weight * Math.pow(2, - value / halfLife);
  }

  private getCardRevenueScore(card: CardRecord): number {
    return this.getLogScore(SCORE_CARD_WEIGHT_REVENUE, card.stats.revenue.value, SCORE_CARD_REVENUE_DOUBLING);
  }

  private getLogScore(weight: number, value: number, doubling: number): number {
    return weight * Math.log10(1 + 100 * value / doubling);
  }
  private async getCardRecentRevenueScore(card: CardRecord): Promise<number> {
    const revenue = card.stats.revenue.value;
    const priorRevenue = await this.getPriorStatValue(card, "revenue", SCORE_CARD_REVENUE_RECENT_INTERVAL);
    const value = revenue - priorRevenue;
    return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_REVENUE, value, SCORE_CARD_RECENT_REVENUE_DOUBLING);
  }

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
  private getCardOpensScore(card: CardRecord): number {
    return this.getLogScore(SCORE_CARD_WEIGHT_OPENS, card.stats.opens.value, SCORE_CARD_OPENS_DOUBLING);
  }
  private async getCardRecentOpensScore(card: CardRecord): Promise<number> {
    const opens = card.stats.opens.value;
    const priorOpens = await this.getPriorStatValue(card, "opens", SCORE_CARD_OPENS_RECENT_INTERVAL);
    const value = opens - priorOpens;
    return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_OPENS, value, SCORE_CARD_RECENT_OPENS_DOUBLING);
  }
  private getCardLikesScore(card: CardRecord): number {
    return this.getLogScore(SCORE_CARD_WEIGHT_LIKES, card.stats.likes.value, SCORE_CARD_LIKES_DOUBLING);
  }
  private getCardControversyScore(card: CardRecord): number {
    const likes = card.stats.likes.value;
    const dislikes = card.stats.dislikes.value;
    const controversy = (likes + dislikes) / (Math.abs(likes - dislikes) + 1);
    return this.getLogScore(SCORE_CARD_WEIGHT_CONTROVERSY, controversy, SCORE_CARD_CONTROVERSY_DOUBLING);
  }

  private async addPreviewCards(): Promise<void> {
    const now = Date.now();
    let user = await this.insertPreviewUser('nytimes', 'nytimes', 'New York Times', this.getPreviewUrl("nytimes.jpg"));
    let card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimes', 'New York Times',
      this.getPreviewUrl("nytimes.jpg"),
      this.getPreviewUrl("puerto_rico.jpg"), 1024, 683,
      null,
      "The Devastation in Puerto Rico, as Seen From Above",
      "Last week, Hurricane Maria made landfall in Puerto Rico with winds of 155 miles an hour, leaving the United States commonwealth on the brink of a humanitarian crisis. The storm left 80 percent of crop value destroyed, 60 percent of the island without water and almost the entire island without power.",
      false,
      null,
      this.getPreviewUrl("icon-news.png"),
      null, 0,
      0, 0, 5,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 25, 30.33, 10, 31);

    user = await this.insertPreviewUser('80sgames', '80sgames', "80's Games", this.getPreviewUrl("80s_games.png"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, '80sgames', "80's Games",
      this.getPreviewUrl("80s_games.png"),
      this.getPreviewUrl("galaga.png"), 1332, 998,
      null,
      "Play Galaga",
      "The online classic 80's arcade game",
      false,
      null,
      this.getPreviewUrl("icon-game.png"),
      null, 0,
      0, 0, 1,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 4.67, 16, 3);

    user = await this.insertPreviewUser('thrillist', 'thrillist', "Thrillist", this.getPreviewUrl("thrillist.jpg"));
    const cardId1 = uuid.v4();
    const couponPromo1 = await this.createPromotionCoupon(user, cardId1, 0.01, 1, 15);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'thrillist', 'Thrillist',
      this.getPreviewUrl("thrillist.jpg"),
      this.getPreviewUrl("pizza_ring.jpg"), 640, 640,
      null,
      "Puff Pizza Ring",
      "Learn how to make this delicious treat",
      false,
      null,
      this.getPreviewUrl("icon-play2.png"),
      null, 0,
      0.01, 0, 3,
      5, 15, couponPromo1.signedObject, couponPromo1.id,
      cardId1);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 15, 3516.84, 4521, 25);

    user = await this.insertPreviewUser('jmodell', 'jmodell', "Josh Modell", this.getPreviewUrl("josh_modell.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'jmodell', 'Josh Modell',
      this.getPreviewUrl("josh_modell.jpg"),
      this.getPreviewUrl("the_national.png"), 800, 532,
      null,
      "The National doesn't rest on the excellent Sleep Well Beast",
      "Albums by The National are like your friendly neighborhood lush: In just an hour or so, they’re able to drink you under the table, say something profound enough to make the whole bar weep, then stumble out into the pre-dawn, proud and ashamed in equal measure.",
      false,
      null,
      this.getPreviewUrl("icon-news.png"),
      null, 0,
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3, 36.90, 342, 5);

    user = await this.insertPreviewUser('nytimescw', 'nytimescw', "NY Times Crosswords", this.getPreviewUrl("nytimes.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimescw', 'NY Times Crosswords',
      this.getPreviewUrl("nytimes.jpg"),
      this.getPreviewUrl("crossword1.jpg"), 640, 480,
      null,
      "Solemn Promise",
      "Solve this mini-crossword in one minute",
      false,
      null,
      this.getPreviewUrl("icon-crossword.png"),
      null, 0,
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 6, 84.04, 251, 2);

    user = await this.insertPreviewUser('cbs', 'cbs', "CBS", this.getPreviewUrl("cbs.jpg"));
    const cardId2 = uuid.v4();
    const couponOpen2 = await this.createOpenCoupon(user, cardId2, 1.00, 10);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'cbs', 'CBS',
      this.getPreviewUrl("cbs.jpg"),
      this.getPreviewUrl("tomb_raider.jpg"), 545, 331,
      null,
      "Tomb Raider",
      "Alicia Vikander is Lara Croft.  Coming soon in 3D.",
      false,
      null,
      this.getPreviewUrl("icon-play2.png"),
      null, 0,
      0, 1, 0,
      10, 0, couponOpen2.signedObject, couponOpen2.id,
      cardId2);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 4, 0, 34251, 245);

    user = await this.insertPreviewUser('tyler', 'tyler', "Tyler McGrath", this.getPreviewUrl("tyler.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'tyler', 'Tyler McGrath',
      this.getPreviewUrl("tyler.jpg"),
      this.getPreviewUrl("ascension.jpg"), 1280, 532,
      null,
      "Ascension",
      "An emerging life form must respond to the unstable and unforgiving terrain of a new home.",
      false,
      null,
      this.getPreviewUrl("icon-play2.png"),
      null, 0,
      0, 0, 8,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 278.33, 342, 21);

    user = await this.insertPreviewUser('roadw', 'roadw', "Road Warrior", this.getPreviewUrl("road-warrior.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'roadw', 'Road Warrior',
      this.getPreviewUrl("road-warrior.jpg"),
      this.getPreviewUrl("dangerous_road.png"), 917, 481,
      null,
      "My Drive on the Most Dangerous Road in the World",
      null,
      false,
      null,
      this.getPreviewUrl("icon-play2.png"),
      null, 0,
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 8, 77.76, 24, 11);

    user = await this.insertPreviewUser('brightside', 'brightside', "Bright Side", this.getPreviewUrl("brightside.png"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'brightside', 'Bright Side',
      this.getPreviewUrl("brightside.png"),
      this.getPreviewUrl("amsterdam.jpg"), 1000, 1413,
      null,
      "The 100 best photographs ever taken without photoshop",
      "According to BrightSide.me",
      false,
      null,
      this.getPreviewUrl("icon-photos.png"),
      null, 0,
      0, 0, 3,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 5, 596.67, 76, 3);

    user = await this.insertPreviewUser('aperrotta', 'aperrotta', "Anthony Perrotta", this.getPreviewUrl("anthony.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'aperrotta', 'Anthony Perrotta',
      this.getPreviewUrl("anthony.jpg"),
      this.getPreviewUrl("rage_cover.jpg"), 400, 600,
      null,
      "Rage Against the Current",
      "It was late August and on the spur of the moment, Joseph and Gomez decided to go to the beach. They had already taken a few bowl hits in the car and now intended on topping that off with the six-pack they were lugging with them across the boardwalk, which looked out over the southern shore of Long Island. Although there was still a few hours of sunlight left, you could already catch a golden glimmer of light bouncing off the ocean's surface, as the water whittled away, little by little, at the sandy earth.",
      false,
      null,
      this.getPreviewUrl("icon-book.png"),
      null, 0,
      0, 0, 6,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 262.65, 99, 21);

    user = await this.insertPreviewUser('uhaque', 'uhaque', "Umair Haque", this.getPreviewUrl("umair.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'uhaque', 'Umair Haque',
      this.getPreviewUrl("umair.jpg"),
      this.getPreviewUrl("uber_explosion.jpg"), 1200, 779,
      null,
      "Five Things to Learn From Uber's Implosion",
      "How to Fail at the Future",
      false,
      null,
      this.getPreviewUrl("icon-news.png"),
      null, 0,
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3.5, 22.08, 15, 18);

    user = await this.insertPreviewUser('bluenile', 'bluenile', "Blue Nile", this.getPreviewUrl("blue_nile.jpg"));
    const cardId3 = uuid.v4();
    const couponPromo3 = await this.createPromotionCoupon(user, cardId3, 0.03, 8, 0);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'bluenile', 'Blue Nile',
      this.getPreviewUrl("blue_nile.jpg"),
      this.getPreviewUrl("blue_nile_diamonds.jpg"), 491, 466,
      "https://www.bluenile.com",
      "New. Brilliant. Astor by Blue Nile",
      "Find the most beautiful diamonds in the world and build your own ring.",
      false,
      null,
      this.getPreviewUrl("icon-link.png"),
      null, 0,
      0.03, 0, 0,
      8, 0, couponPromo3.signedObject, couponPromo3.id,
      cardId3);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 0, 78, 3);

    user = await this.insertPreviewUser('jigsaw', 'jigsaw', "Jigsaw", this.getPreviewUrl("jigsaw.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'jigsaw', 'Jigsaw',
      this.getPreviewUrl("jigsaw.jpg"),
      this.getPreviewUrl("unfiltered_news.jpg"), 1001, 571,
      null,
      "The Latest Unfiltered News",
      "Explore news from around the world that are outside the mainstream media",
      false,
      null,
      this.getPreviewUrl("icon-touch.png"),
      null, 0,
      0, 0, 4,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 7.5, 576.25, 44, 7);

    user = await this.insertPreviewUser('pyro', 'pyro', "Pyro Podcast", this.getPreviewUrl("podcast_handle.jpg"));
    const cardId4 = uuid.v4();
    const couponPromo4 = await this.createPromotionCoupon(user, cardId4, 0.01, 2, 10);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'pyro', 'Pyro Podcast',
      this.getPreviewUrl("podcast_handle.jpg"),
      this.getPreviewUrl("football_podcast.jpg"), 985, 554,
      null,
      "Pyro Podcast Show 285",
      "Foreshadowing Week 4",
      false,
      null,
      this.getPreviewUrl("icon-audio.png"),
      null, 0,
      0.01, 0, 5,
      3, 10, couponPromo4.signedObject, couponPromo4.id,
      cardId4);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 2, 201.24, 99, 4);
  }

  private async createPromotionCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number, budgetPlusPercent: number): Promise<CouponInfo> {
    return this.createCoupon(user, cardId, amount, budgetAmount, budgetAmount, "card-promotion");
  }

  private async createOpenCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number): Promise<CouponInfo> {
    return this.createCoupon(user, cardId, amount, budgetAmount, 0, "card-open-payment");
  }

  private async createCoupon(user: UserWithKeyUtils, cardId: string, amount: number, budgetAmount: number, budgetPlusPercent: number, reason: BankTransactionReason): Promise<CouponInfo> {
    const details: BankCouponDetails = {
      address: user.user.address,
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

  private async insertPreviewUser(id: string, handle: string, name: string, imageUrl: string): Promise<UserWithKeyUtils> {
    const privateKey = KeyUtils.generatePrivateKey();
    const keyInfo = KeyUtils.getKeyInfo(privateKey);
    const inviteCode = await userManager.generateInviteCode();
    const identity: UserIdentity = {
      name: name,
      handle: handle,
      imageUrl: imageUrl,
      emailAddress: null,
      location: null
    };
    const user = await db.insertUser("normal", keyInfo.address, keyInfo.publicKeyPem, null, null, inviteCode, 0, 0, 0, null, id, identity);
    const grantDetails: BankTransactionDetails = {
      address: null,
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
      portion: "remainder"
    });
    await networkEntity.performBankTransaction(grantDetails, null, true);
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
