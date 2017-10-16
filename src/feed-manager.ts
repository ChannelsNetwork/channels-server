import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, CardRecord, BankTransactionReason, BankCouponDetails } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { RestRequest, PostCardDetails, PostCardResponse, GetFeedDetails, GetFeedResponse, CardDescriptor, CardFeedSet, RequestedFeedDescriptor, BankTransactionDetails } from "./interfaces/rest-services";
import { cardManager } from "./card-manager";
import { FeedHandler, socketServer } from "./socket-server";
import { Initializable } from "./interfaces/initializable";
import { UserHelper } from "./user-helper";
import { userManager } from "./user-manager";
import { KeyUtils, KeyInfo } from "./key-utils";
import * as uuid from "uuid";
import { SignedObject } from "./interfaces/signed-object";
import { bank } from "./bank";
import { networkEntity } from "./network-entity";

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

export class FeedManager implements Initializable, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private highScoreCards: CardDescriptor[] = [];
  private lastHighScoreCardsAt = 0;
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
        feeds: []
      };
      const promises: Array<Promise<CardFeedSet>> = [];
      for (const requestedFeed of requestBody.detailsObject.feeds) {
        promises.push(this.getUserFeed(user, requestedFeed));
      }
      reply.feeds = await Promise.all(promises);
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetFeed: Failure", err);
      response.status(500).send(err);
    }
  }

  async getUserFeed(user: UserRecord, feed: RequestedFeedDescriptor): Promise<CardFeedSet> {
    const result: CardFeedSet = {
      type: feed.type,
      cards: []
    };
    switch (feed.type) {
      case "recommended":
        result.cards = await this.getRecommendedFeed(user, feed.maxCount);
        break;
      case 'new':
        result.cards = await this.getRecentlyAddedFeed(user, feed.maxCount);
        break;
      case 'mine':
        result.cards = await this.getRecentlyPostedFeed(user, feed.maxCount);
        break;
      case 'opened':
        result.cards = await this.getRecentlyOpenedFeed(user, feed.maxCount);
        break;
      default:
        throw new Error("Unhandled feed type " + feed.type);
    }
    return result;
  }

  private async getRecommendedFeed(user: UserRecord, limit: number): Promise<CardDescriptor[]> {
    // The recommended feed consists of cards we think the user will be most interested in.  This can get
    // more sophisticated over time.  For now, it works by using a cached set of the cards that have
    // the highest overall scores (determined independent of any one user).  For each of these cards, we
    // adjust the scores based on factors that are specific to this user.  And we add a random variable
    // resulting in some churn across the set.  Then we take the top N based on how many were requested.
    const highScores = await this.getCardsWithHighestScores();
    const promises: Array<Promise<CardWithUserScore>> = [];
    for (const highScore of highScores) {
      if (!UserHelper.isUsersAddress(user, highScore.by.address)) {
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
    return result;
  }

  private async getCardsWithHighestScores(): Promise<CardDescriptor[]> {
    const now = Date.now();
    if (now - this.lastHighScoreCardsAt < HIGH_SCORE_CARD_CACHE_LIFE) {
      return this.highScoreCards;
    }
    this.lastHighScoreCardsAt = now;
    const cards = await db.findCardsByScore(HIGH_SCORE_CARD_COUNT);
    this.highScoreCards = await this.populateCards(cards);
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

  private async getRecentlyAddedFeed(user: UserRecord, limit: number): Promise<CardDescriptor[]> {
    const cards = await db.findCardsByTime(Date.now(), 0, limit);
    return await this.populateCards(cards, user);
  }

  private async getRecentlyPostedFeed(user: UserRecord, limit: number): Promise<CardDescriptor[]> {
    const cards = await db.findCardsByTime(Date.now(), 0, limit, user.id);
    return await this.populateCards(cards, user);
  }

  private async getRecentlyOpenedFeed(user: UserRecord, limit: number): Promise<CardDescriptor[]> {
    const infos = await db.findRecentCardOpens(user.id, limit);
    const cards: CardRecord[] = [];
    for (const info of infos) {
      cards.push(await db.findCardById(info.cardId));
    }
    return await this.populateCards(cards, user);
  }

  private async populateCards(cards: CardRecord[], user?: UserRecord): Promise<CardDescriptor[]> {
    const promises: Array<Promise<CardDescriptor>> = [];
    for (const card of cards) {
      promises.push(cardManager.populateCardState(card.id, false, user));
    }
    const result = await Promise.all(promises);
    return result;
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
        if (card.score.value !== score) {
          console.log("Feed.rescoreCard: Updating card score", card.id, score, addHistory);
          await db.updateCardScore(card, score, addHistory);
          // TODO: also copy other stats into history
        }
        if (card.score.history.length > 10) {
          await db.clearCardScoreHistoryBefore(card, card.score.history[card.score.history.length - 11].at);
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
    score += this.getCardRecentRevenueScore(card);
    score += this.getCardOpensScore(card);
    score += this.getCardRecentOpensScore(card);
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
    return this.getLogScore(SCORE_CARD_WEIGHT_REVENUE, card.revenue.value, SCORE_CARD_REVENUE_DOUBLING);
  }

  private getLogScore(weight: number, value: number, doubling: number): number {
    return weight * Math.log10(1 + 100 * value / doubling);
  }
  private getCardRecentRevenueScore(card: CardRecord): number {
    let priorRevenue = 0;
    for (const item of card.revenue.history) {
      if (item.at < Date.now() - SCORE_CARD_REVENUE_RECENT_INTERVAL) {
        break;
      }
      priorRevenue = item.value;
    }
    const value = card.revenue.value - priorRevenue;
    return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_REVENUE, value, SCORE_CARD_RECENT_REVENUE_DOUBLING);
  }
  private getCardOpensScore(card: CardRecord): number {
    return this.getLogScore(SCORE_CARD_WEIGHT_OPENS, card.opens.value, SCORE_CARD_OPENS_DOUBLING);
  }
  private getCardRecentOpensScore(card: CardRecord): number {
    let priorOpens = 0;
    for (const item of card.revenue.history) {
      if (item.at < Date.now() - SCORE_CARD_OPENS_RECENT_INTERVAL) {
        break;
      }
      priorOpens = item.value;
    }
    const value = card.revenue.value - priorOpens;
    return this.getLogScore(SCORE_CARD_WEIGHT_RECENT_OPENS, value, SCORE_CARD_RECENT_OPENS_DOUBLING);
  }
  private getCardLikesScore(card: CardRecord): number {
    return this.getLogScore(SCORE_CARD_WEIGHT_LIKES, card.likes.value, SCORE_CARD_LIKES_DOUBLING);
  }
  private getCardControversyScore(card: CardRecord): number {
    const controversy = (card.likes.value + card.dislikes.value) / (Math.abs(card.likes.value - card.dislikes.value) + 1);
    return this.getLogScore(SCORE_CARD_WEIGHT_CONTROVERSY, controversy, SCORE_CARD_CONTROVERSY_DOUBLING);
  }

  private async addPreviewCards(): Promise<void> {
    const now = Date.now();
    let user = await this.insertPreviewUser('nytimes', 'nytimes', 'New York Times', this.getPreviewUrl("nytimes.jpg"));
    let card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimes', 'New York Times',
      this.getPreviewUrl("nytimes.jpg"),
      this.getPreviewUrl("puerto_rico.jpg"),
      null,
      "The Devastation in Puerto Rico, as Seen From Above",
      "Last week, Hurricane Maria made landfall in Puerto Rico with winds of 155 miles an hour, leaving the United States commonwealth on the brink of a humanitarian crisis. The storm left 80 percent of crop value destroyed, 60 percent of the island without water and almost the entire island without power.",
      null,
      this.getPreviewUrl("icon-news.png"),
      0, 0, 5,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 25, 30.33, 10, 31);

    user = await this.insertPreviewUser('80sgames', '80sgames', "80's Games", this.getPreviewUrl("80s_games.png"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, '80sgames', "80's Games",
      this.getPreviewUrl("80s_games.png"),
      this.getPreviewUrl("galaga.png"),
      null,
      "Play Galaga",
      "The online classic 80's arcade game",
      null,
      this.getPreviewUrl("icon-game.png"),
      0, 0, 1,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 4.67, 16, 3);

    user = await this.insertPreviewUser('thrillist', 'thrillist', "Thrillist", this.getPreviewUrl("thrillist.jpg"));
    const cardId1 = uuid.v4();
    const couponPromo1 = await this.createPromotionCoupon(user, cardId1, 0.01, 1, 15);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'thrillist', 'Thrillist',
      this.getPreviewUrl("thrillist.jpg"),
      this.getPreviewUrl("pizza_ring.jpg"),
      null,
      "Puff Pizza Ring",
      "Learn how to make this delicious treat",
      null,
      this.getPreviewUrl("icon-play2.png"),
      0.01, 0, 3,
      5, 15, couponPromo1.signedObject, couponPromo1.id,
      cardId1);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 15, 3516.84, 4521, 25);

    user = await this.insertPreviewUser('jmodell', 'jmodell', "Josh Modell", this.getPreviewUrl("josh_modell.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'jmodell', 'Josh Modell',
      this.getPreviewUrl("josh_modell.jpg"),
      this.getPreviewUrl("the_national.png"),
      null,
      "The National doesn't rest on the excellent Sleep Well Beast",
      "Albums by The National are like your friendly neighborhood lush: In just an hour or so, they’re able to drink you under the table, say something profound enough to make the whole bar weep, then stumble out into the pre-dawn, proud and ashamed in equal measure.",
      null,
      this.getPreviewUrl("icon-news.png"),
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3, 36.90, 342, 5);

    user = await this.insertPreviewUser('nytimescw', 'nytimescw', "NY Times Crosswords", this.getPreviewUrl("nytimes.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'nytimescw', 'NY Times Crosswords',
      this.getPreviewUrl("nytimes.jpg"),
      this.getPreviewUrl("crossword1.jpg"),
      null,
      "Solemn Promise",
      "Solve this mini-crossword in one minute",
      null,
      this.getPreviewUrl("icon-crossword.png"),
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 6, 84.04, 251, 2);

    user = await this.insertPreviewUser('cbs', 'cbs', "CBS", this.getPreviewUrl("cbs.jpg"));
    const cardId2 = uuid.v4();
    const couponOpen2 = await this.createOpenCoupon(user, cardId2, 1.00, 10);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'cbs', 'CBS',
      this.getPreviewUrl("cbs.jpg"),
      this.getPreviewUrl("tomb_raider.jpg"),
      null,
      "Tomb Raider",
      "Alicia Vikander is Lara Croft.  Coming soon in 3D.",
      null,
      this.getPreviewUrl("icon-play2.png"),
      0, 1, 0,
      10, 0, couponOpen2.signedObject, couponOpen2.id,
      cardId2);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 4, 0, 34251, 245);

    user = await this.insertPreviewUser('tyler', 'tyler', "Tyler McGrath", this.getPreviewUrl("tyler.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'tyler', 'Tyler McGrath',
      this.getPreviewUrl("tyler.jpg"),
      this.getPreviewUrl("ascension.jpg"),
      null,
      "Ascension",
      "An emerging life form must respond to the unstable and unforgiving terrain of a new home.",
      null,
      this.getPreviewUrl("icon-play2.png"),
      0, 0, 8,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 278.33, 342, 21);

    user = await this.insertPreviewUser('roadw', 'roadw', "Road Warrior", this.getPreviewUrl("road-warrior.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'roadw', 'Road Warrior',
      this.getPreviewUrl("road-warrior.jpg"),
      this.getPreviewUrl("dangerous_road.png"),
      null,
      "My Drive on the Most Dangerous Road in the World",
      null,
      null,
      this.getPreviewUrl("icon-play2.png"),
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 8, 77.76, 24, 11);

    user = await this.insertPreviewUser('brightside', 'brightside', "Bright Side", this.getPreviewUrl("brightside.png"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'brightside', 'Bright Side',
      this.getPreviewUrl("brightside.png"),
      this.getPreviewUrl("amsterdam.jpg"),
      null,
      "The 100 best photographs ever taken without photoshop",
      "According to BrightSide.me",
      null,
      this.getPreviewUrl("icon-photos.png"),
      0, 0, 3,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 5, 596.67, 76, 3);

    user = await this.insertPreviewUser('aperrotta', 'aperrotta', "Anthony Perrotta", this.getPreviewUrl("anthony.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'aperrotta', 'Anthony Perrotta',
      this.getPreviewUrl("anthony.jpg"),
      this.getPreviewUrl("rage_cover.jpg"),
      null,
      "Rage Against the Current",
      "It was late August and on the spur of the moment, Joseph and Gomez decided to go to the beach. They had already taken a few bowl hits in the car and now intended on topping that off with the six-pack they were lugging with them across the boardwalk, which looked out over the southern shore of Long Island. Although there was still a few hours of sunlight left, you could already catch a golden glimmer of light bouncing off the ocean's surface, as the water whittled away, little by little, at the sandy earth.",
      null,
      this.getPreviewUrl("icon-book.png"),
      0, 0, 6,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 24 * 3, 262.65, 99, 21);

    user = await this.insertPreviewUser('uhaque', 'uhaque', "Umair Haque", this.getPreviewUrl("umair.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'uhaque', 'Umair Haque',
      this.getPreviewUrl("umair.jpg"),
      this.getPreviewUrl("uber_explosion.jpg"),
      null,
      "Five Things to Learn From Uber's Implosion",
      "How to Fail at the Future",
      null,
      this.getPreviewUrl("icon-news.png"),
      0, 0, 2,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 3.5, 22.08, 15, 18);

    user = await this.insertPreviewUser('bluenile', 'bluenile', "Blue Nile", this.getPreviewUrl("blue_nile.jpg"));
    const cardId3 = uuid.v4();
    const couponPromo3 = await this.createPromotionCoupon(user, cardId3, 0.03, 8, 0);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'bluenile', 'Blue Nile',
      this.getPreviewUrl("blue_nile.jpg"),
      this.getPreviewUrl("blue_nile_diamonds.jpg"),
      "https://www.bluenile.com",
      "New. Brilliant. Astor by Blue Nile",
      "Find the most beautiful diamonds in the world and build your own ring.",
      null,
      this.getPreviewUrl("icon-link.png"),
      0.03, 0, 0,
      8, 0, couponPromo3.signedObject, couponPromo3.id,
      cardId3);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 9, 0, 78, 3);

    user = await this.insertPreviewUser('jigsaw', 'jigsaw', "Jigsaw", this.getPreviewUrl("jigsaw.jpg"));
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'jigsaw', 'Jigsaw',
      this.getPreviewUrl("jigsaw.jpg"),
      this.getPreviewUrl("unfiltered_news.jpg"),
      null,
      "The Latest Unfiltered News",
      "Explore news from around the world that are outside the mainstream media",
      null,
      this.getPreviewUrl("icon-touch.png"),
      0, 0, 4,
      0, 0, null, null);
    await db.updateCardStats_Preview(card.id, 1000 * 60 * 60 * 7.5, 576.25, 44, 7);

    user = await this.insertPreviewUser('pyro', 'pyro', "Pyro Podcast", this.getPreviewUrl("podcast_handle.jpg"));
    const cardId4 = uuid.v4();
    const couponPromo4 = await this.createPromotionCoupon(user, cardId4, 0.01, 2, 10);
    card = await db.insertCard(user.user.id, user.keyInfo.address, 'pyro', 'Pyro Podcast',
      this.getPreviewUrl("podcast_handle.jpg"),
      this.getPreviewUrl("football_podcast.jpg"),
      null,
      "Pyro Podcast Show 285",
      "Foreshadowing Week 4",
      null,
      this.getPreviewUrl("icon-audio.png"),
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
      address: user.user.keys[0].address,
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
    const user = await db.insertUser("normal", keyInfo.address, keyInfo.publicKeyPem, null, inviteCode, 0, 0, id);
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
      address: user.keys[0].address,
      portion: "remainder"
    });
    await networkEntity.performBankTransaction(grantDetails, true);
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
