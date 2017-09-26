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
import { RestRequest, PostCardDetails, PostCardResponse, GetFeedDetails, GetFeedResponse, CardDescriptor } from "./interfaces/rest-services";
import { cardManager } from "./card-manager";
import { FeedHandler, socketServer } from "./socket-server";
import { Initializable } from "./interfaces/initializable";

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

export class FeedManager implements Initializable, FeedHandler {
  async initialize(): Promise<void> {
    socketServer.registerFeedHandler(this);
  }
  async initialize2(): Promise<void> {
    setInterval(() => {
      void this.poll();
    }, POLLING_INTERVAL);
  }

  async getUserFeed(userAddress: string, maxCount: number, before?: number, after?: number): Promise<CardDescriptor[]> {
    const result: CardDescriptor[] = [];
    const cardRecords = await db.findCardsByTime(before, after, Math.min(maxCount, 25));
    const promises: Array<Promise<CardDescriptor>> = [];
    for (const record of cardRecords) {
      promises.push(cardManager.populateCardState(record.id, userAddress));
    }
    const cardReplies = await Promise.all(promises);
    const cards: CardDescriptor[] = [];
    for (const card of cardReplies) {
      if (card) {
        cards.push(card);
      }
    }
    cards.sort((a: CardDescriptor, b: CardDescriptor) => {
      return a.postedAt - b.postedAt;
    });
    return result;
  }
  private async handleFeed(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<GetFeedDetails>;
    const user = await RestHelper.validateRegisteredRequest(requestBody, response);
    if (!user) {
      return;
    }
    if (requestBody.details) {
      requestBody.detailsObject = JSON.parse(requestBody.details);
    }
    const maxCount = Math.max(1, Math.min(requestBody.detailsObject.maxCount ? requestBody.detailsObject.maxCount : 100, 100));
    const beforeCard = await db.findCardById(requestBody.detailsObject.beforeCardId);
    const afterCard = await db.findCardById(requestBody.detailsObject.afterCardId);
    const cardRecords = await db.findCards(beforeCard, afterCard, maxCount);
    const reply: GetFeedResponse = {
      cards: []
    };
    const promises: Array<Promise<CardDescriptor>> = [];
    for (const record of cardRecords) {
      promises.push(cardManager.populateCardState(record.id, user.address));
    }
    const cardReplies = await Promise.all(promises);
    const cards: CardDescriptor[] = [];
    for (const card of cardReplies) {
      if (card) {
        cards.push(card);
      }
    }
    cards.sort((a: CardDescriptor, b: CardDescriptor) => {
      return a.postedAt - b.postedAt;
    });
    reply.cards = cards;
    console.log("UserManager.feed: " + cardRecords.length + " cards returned", requestBody.details);
    response.json(reply);
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
}

const feedManager = new FeedManager();

export { feedManager };
