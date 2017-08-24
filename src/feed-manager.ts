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

export class FeedManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
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
    if (requestBody.details) {
      requestBody.detailsObject = JSON.parse(requestBody.details);
    }
    if (!requestBody.detailsObject.text) {
      response.status(400).send("The text for your card is missing.");
      return;
    }
    console.log("UserManager.post-card", requestBody.details);
    const card = await db.insertCard(user.address, user.identity.handle, user.identity.name, requestBody.detailsObject.text);
    const reply: PostCardResponse = {
      cardId: card.id
    };
    response.json(reply);
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
    for (const record of cardRecords) {
      const card: CardDescriptor = {
        id: record.id,
        at: record.at,
        by: {
          address: record.by.address,
          handle: record.by.handle,
          name: record.by.name
        },
        text: record.text
      };
      reply.cards.push(card);
    }
    console.log("UserManager.feed: " + cardRecords.length + " cards returned", requestBody.details);
    response.json(reply);
  }

}

const feedManager = new FeedManager();

export { feedManager };
