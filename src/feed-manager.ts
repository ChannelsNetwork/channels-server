import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { UserRecord, CardRecord } from "./interfaces/db-records";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { RestRequest, PostCardDetails, PostCardResponse, GetFeedDetails, GetFeedResponse, CardDescriptor, CardFeedSet, RequestedFeedDescriptor } from "./interfaces/rest-services";
import { cardManager } from "./card-manager";
import { FeedHandler, socketServer } from "./socket-server";
import { Initializable } from "./interfaces/initializable";
import { UserHelper } from "./user-helper";

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

  // private getPreviewCards(): CardDescriptor[] {
  //   const now = Date.now();
  //   const result: CardDescriptor[] = [
  //     {
  //       id: 'p1',
  //       postedAt: now - 1000 * 60 * 5,
  //       by: {
  //         address: 'nyt',
  //         handle: 'nytimes',
  //         name: "New York Times",
  //         imageUrl: this.getPreviewUrl("nytimes.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("peurto_rico.jpg"),
  //         linkUrl: null,
  //         title: "The Devastation in Puerto Rico, as Seen From Above",
  //         text: "Last week, Hurricane Maria made landfall in Puerto Rico with winds of 155 miles an hour, leaving the United States commonwealth on the brink of a humanitarian crisis. The storm left 80 percent of crop value destroyed, 60 percent of the island without water and almost the entire island without power."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_article.jpg")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.25,
  //         openFeeUnits: 5
  //       },
  //       history: {
  //         revenue: 30.33,
  //         impressions: 0,
  //         opens: 121,
  //         likes: 1,
  //         dislikes: 2
  //       }
  //     },
  //     {
  //       id: 'p2',
  //       postedAt: now - 1000 * 60 * 34,
  //       by: {
  //         address: '80sgames',
  //         handle: '80sgames',
  //         name: "80's Games",
  //         imageUrl: this.getPreviewUrl("80s_games.png"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("galaga.png"),
  //         linkUrl: null,
  //         title: "Play Galaga",
  //         text: "The online classic 80's arcade game"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_game.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.05,
  //         openFeeUnits: 1
  //       },
  //       history: {
  //         revenue: 4.67,
  //         impressions: 0,
  //         opens: 93,
  //         likes: 8,
  //         dislikes: 1
  //       }
  //     },
  //     {
  //       id: 'p3',
  //       postedAt: now - 1000 * 60 * 4000,
  //       by: {
  //         address: 'thrillist',
  //         handle: 'thrillist',
  //         name: "Thrillist",
  //         imageUrl: this.getPreviewUrl("thrillist.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("pizza_ring.jpg"),
  //         linkUrl: null,
  //         title: "Puff Pizza Ring",
  //         text: "Learn how to make this delicious treat"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_play.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.15,
  //         openFeeUnits: 3
  //       },
  //       history: {
  //         revenue: 3516.84,
  //         impressions: 0,
  //         opens: 23446,
  //         likes: 445,
  //         dislikes: 23
  //       }
  //     },
  //     {
  //       id: 'p4',
  //       postedAt: now - 1000 * 60 * 189,
  //       by: {
  //         address: 'jmodell',
  //         handle: 'jmodell',
  //         name: "Josh Modell",
  //         imageUrl: this.getPreviewUrl("josh_modell.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("the_national.png"),
  //         linkUrl: null,
  //         title: "The National doesn't rest on the excellent Sleep Well Beast",
  //         text: "Albums by The National are like your friendly neighborhood lush: In just an hour or so, they’re able to drink you under the table, say something profound enough to make the whole bar weep, then stumble out into the pre-dawn, proud and ashamed in equal measure."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_article.jpg")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.10,
  //         openFeeUnits: 2
  //       },
  //       history: {
  //         revenue: 36.90,
  //         impressions: 0,
  //         opens: 369,
  //         likes: 7,
  //         dislikes: 1
  //       }
  //     },
  //     {
  //       id: 'p5',
  //       postedAt: now - 1000 * 60 * 265,
  //       by: {
  //         address: 'nyt',
  //         handle: 'nytimes',
  //         name: "NY Times Crosswords",
  //         imageUrl: this.getPreviewUrl("nytimes.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("mini_crossword.jpg"),
  //         linkUrl: null,
  //         title: "Solemn Promise",
  //         text: "Solve this mini-crossword in one minute"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_crossword.jpg")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.10,
  //         openFeeUnits: 2
  //       },
  //       history: {
  //         revenue: 84.04,
  //         impressions: 0,
  //         opens: 840,
  //         likes: 16,
  //         dislikes: 1
  //       }
  //     },
  //     {
  //       id: 'a2',
  //       postedAt: now - 1000 * 60 * 984,
  //       by: {
  //         address: 'cbs',
  //         handle: 'cbs',
  //         name: "CBS",
  //         imageUrl: this.getPreviewUrl("cbs.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("tomb_raider.jpg"),
  //         linkUrl: null,
  //         title: "Tomb Raider",
  //         text: "Alicia Vikander is Lara Croft.  Coming soon in 3D."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_play.png")
  //       },
  //       pricing: {
  //         promotionFee: 0.11,
  //         openFee: -1,
  //         openFeeUnits: 0
  //       },
  //       history: {
  //         revenue: 0,
  //         impressions: 0,
  //         opens: 0,
  //         likes: 40,
  //         dislikes: 5
  //       }
  //     },
  //     {
  //       id: 'p6',
  //       postedAt: now - 1000 * 60 * 380,
  //       by: {
  //         address: 'tyler',
  //         handle: 'tyler',
  //         name: "Tyler McGrath",
  //         imageUrl: this.getPreviewUrl("tyler.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("ascension.jpg"),
  //         linkUrl: null,
  //         title: "Ascension",
  //         text: "An emerging life form must respond to the unstable and unforgiving terrain of a new home."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_play.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.40,
  //         openFeeUnits: 8
  //       },
  //       history: {
  //         revenue: 278.33,
  //         impressions: 0,
  //         opens: 696,
  //         likes: 13,
  //         dislikes: 1
  //       }
  //     },
  //     {
  //       id: 'p7',
  //       postedAt: now - 1000 * 60 * 2165,
  //       by: {
  //         address: '',
  //         handle: '',
  //         name: "",
  //         imageUrl: this.getPreviewUrl(""),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("dangerous_road.png"),
  //         linkUrl: null,
  //         title: "My Drive on the Most Dangerous Road in the World",
  //         text: ""
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_play.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.10,
  //         openFeeUnits: 2
  //       },
  //       history: {
  //         revenue: 77.76,
  //         impressions: 0,
  //         opens: 778,
  //         likes: 12,
  //         dislikes: 3
  //       }
  //     },
  //     {
  //       id: 'p8',
  //       postedAt: now - 1000 * 60 * 2286,
  //       by: {
  //         address: 'brightside',
  //         handle: 'brightside',
  //         name: "Bright Side",
  //         imageUrl: this.getPreviewUrl(""),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("amsterdam.jpg"),
  //         linkUrl: null,
  //         title: "The 100 best photographs ever taken without photoshop",
  //         text: "According to BrightSide.me"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_photos.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.15,
  //         openFeeUnits: 3
  //       },
  //       history: {
  //         revenue: 596.67,
  //         impressions: 0,
  //         opens: 3978,
  //         likes: 76,
  //         dislikes: 4
  //       }
  //     },
  //     {
  //       id: 'p9',
  //       postedAt: now - 1000 * 60 * 3000,
  //       by: {
  //         address: 'aperrotta',
  //         handle: 'aperrotta',
  //         name: "Anthony Perrotta",
  //         imageUrl: this.getPreviewUrl(""),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("rage_cover.jpg"),
  //         linkUrl: null,
  //         title: "Rage Against the Current",
  //         text: "It was late August and on the spur of the moment, Joseph and Gomez decided to go to the beach. They had already taken a few bowl hits in the car and now intended on topping that off with the six-pack they were lugging with them across the boardwalk, which looked out over the southern shore of Long Island. Although there was still a few hours of sunlight left, you could already catch a golden glimmer of light bouncing off the ocean's surface, as the water whittled away, little by little, at the sandy earth."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_book.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.30,
  //         openFeeUnits: 6
  //       },
  //       history: {
  //         revenue: 262.65,
  //         impressions: 0,
  //         opens: 875,
  //         likes: 15,
  //         dislikes: 3
  //       }
  //     },
  //     {
  //       id: 'p10',
  //       postedAt: now - 1000 * 60 * 54,
  //       by: {
  //         address: 'uhaque',
  //         handle: 'uhaque',
  //         name: "Umair Haque",
  //         imageUrl: this.getPreviewUrl("umair.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("uber_explosion.jpg"),
  //         linkUrl: null,
  //         title: "Five Things to Learn From Uber's Implosion",
  //         text: "How to Fail at the Future"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_article.jpg")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.10,
  //         openFeeUnits: 2
  //       },
  //       history: {
  //         revenue: 22.08,
  //         impressions: 0,
  //         opens: 221,
  //         likes: 3,
  //         dislikes: 1
  //       }
  //     },
  //     {
  //       id: 'a1',
  //       postedAt: now - 1000 * 60 * 137,
  //       by: {
  //         address: 'bluenile',
  //         handle: 'bluenile',
  //         name: "Blue Nile",
  //         imageUrl: this.getPreviewUrl("blue_nile.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("blue_nile_diamonds.jpg"),
  //         linkUrl: "https://www.bluenile.com",
  //         title: "New. Brilliant. Astor by Blue Nile",
  //         text: "Find the most beautiful diamonds in the world and build your own ring."
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_link.png")
  //       },
  //       pricing: {
  //         promotionFee: 0.10,
  //         openFee: -0.50,
  //         openFeeUnits: 0
  //       },
  //       history: {
  //         revenue: 0,
  //         impressions: 0,
  //         opens: 85,
  //         likes: 1,
  //         dislikes: 4
  //       }
  //     },
  //     {
  //       id: 'p11',
  //       postedAt: now - 1000 * 60 * 4650,
  //       by: {
  //         address: 'jigsaw',
  //         handle: 'jigsaw',
  //         name: "Jigsaw",
  //         imageUrl: this.getPreviewUrl("jigsaw.jpg"),
  //         isFollowing: false,
  //         isBlocked: false
  //       },
  //       summary: {
  //         imageUrl: this.getPreviewUrl("unfiltered_news.jpg"),
  //         linkUrl: null,
  //         title: "The Latest Unfiltered News",
  //         text: "Explore news from around the world that are outside the mainstream media"
  //       },
  //       cardType: {
  //         package: null,
  //         iconUrl: this.getPreviewUrl("icon_interactive.png")
  //       },
  //       pricing: {
  //         promotionFee: 0,
  //         openFee: 0.20,
  //         openFeeUnits: 4
  //       },
  //       history: {
  //         revenue: 576.25,
  //         impressions: 0,
  //         opens: 2881,
  //         likes: 50,
  //         dislikes: 7
  //       }
  //     }
  //     // ,
  //     // {
  //     //   id: 'p1',
  //     //   postedAt: now - 1000 * 60 * ,
  //     //   by: {
  //     //     address: '',
  //     //     handle: '',
  //     //     name: "",
  //     //     imageUrl: this.getPreviewUrl(""),
  //     //     isFollowing: false,
  //     //     isBlocked: false
  //     //   },
  //     //   summary: {
  //     //     imageUrl: this.getPreviewUrl(""),
  //     //     linkUrl: null,
  //     //     title: "",
  //     //     text: ""
  //     //   },
  //     //   cardType: {
  //     //     package: null,
  //     //     iconUrl: this.getPreviewUrl("")
  //     //   },
  //     //   pricing: {
  //     //     promotionFee: 0,
  //     //     openFee: 0,
  //     //     openFeeUnits: 0
  //     //   },
  //     //   history: {
  //     //     revenue: 0,
  //     //     impressions: 0,
  //     //     opens: 0,
  //     //     likes: 0,
  //     //     dislikes: 0
  //     //   }
  //     // },
  //   ];
  //   return result;
  // }

  private getPreviewUrl(relative: string): string {
    return this.urlManager.getPublicUrl("preview/" + relative, true);
  }
}

const feedManager = new FeedManager();

export { feedManager };

export interface CardWithUserScore {
  card: CardDescriptor;
  fullScore: number;
}
