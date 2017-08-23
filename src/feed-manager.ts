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

export class FeedManager implements Initializable, FeedHandler {
  async initialize(): Promise<void> {
    socketServer.registerFeedHandler(this);
  }
  async initialize2(): Promise<void> {
    // noop
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
      return a.at - b.at;
    });
    return result;
  }
  private async handleFeed(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<GetFeedDetails>;
    const user = await RestHelper.validateRegisteredRequest(requestBody, response);
    if (!user) {
      return;
    }
    const maxCount = Math.max(1, Math.min(requestBody.details.maxCount ? requestBody.details.maxCount : 100, 100));
    const beforeCard = await db.findCardById(requestBody.details.beforeCardId);
    const afterCard = await db.findCardById(requestBody.details.afterCardId);
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
      return a.at - b.at;
    });
    reply.cards = cards;
    console.log("UserManager.feed: " + cardRecords.length + " cards returned", requestBody.details);
    response.json(reply);
  }

}

const feedManager = new FeedManager();

export { feedManager };
