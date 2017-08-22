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

export class FeedManager implements Initializable, RestServer, FeedHandler {
  private app: express.Application;
  private urlManager: UrlManager;

  async initialize(): Promise<void> {
    socketServer.registerFeedHandler(this);
  }
  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }
  async initialize2(): Promise<void> {
    // noop
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('post-card'), (request: Request, response: Response) => {
      void this.handlePostCard(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('feed'), (request: Request, response: Response) => {
      void this.handleFeed(request, response);
    });
  }

  private async handlePostCard(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<PostCardDetails>;
    const user = await RestHelper.validateRegisteredRequest(requestBody, response);
    if (!user) {
      return;
    }
    if (!user.identity || !user.identity.handle) {
      response.status(403).send("You must have a handle associated with your identity.");
      return;
    }
    if (!requestBody.details.text) {
      response.status(400).send("The text for your card is missing.");
      return;
    }
    if (!requestBody.details.cardType) {
      response.status(400).send("The cardType for your card is missing.");
      return;
    }
    console.log("UserManager.post-card", requestBody.details);
    const card = await db.insertCard(user.address, user.identity.handle, user.identity.name, null, null, null, requestBody.details.text, requestBody.details.cardType);
    const reply: PostCardResponse = {
      success: true,
      cardId: card.id
    };
    response.json(reply);
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
      success: true,
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
