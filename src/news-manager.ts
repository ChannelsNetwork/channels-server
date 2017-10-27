import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, GetNewsDetails, GetNewsResponse, NewsItem } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { NewsItemRecord } from "./interfaces/db-records";
import { SERVER_VERSION } from "./server-version";

const NEWS_ITEMS: NewsItemRecord[] = [{
  id: "1",
  timestamp: Date.now(),
  title: "Channels Whitepaper",
  text: "We've made our comprehensive technical description of Channels available for everyone to read.",
  imageUrl: "https://channels.cc/s/images/logo180.png",
  linkUrl: "https://channels.cc/s/whitepaper.pdf"
},
{
  id: "2",
  timestamp: Date.now(),
  title: "Whitepaper Updated",
  text: "We've updated the whitepaper with additional details and descriptions.",
  imageUrl: "https://channels.cc/s/images/logo180.png",
  linkUrl: "https://channels.cc/s/whitepaper_1_1.pdf"
}
];

export class NewsManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
    for (const item of NEWS_ITEMS) {
      const existingItem = await db.findNewsItemById(item.id);
      if (!existingItem) {
        await db.insertNewsItem(item);
      }
    }
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('get-news'), (request: Request, response: Response) => {
      void this.handleGetNews(request, response);
    });
  }

  private async handleGetNews(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetNewsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("NewsManager.handleGetNews", requestBody.detailsObject.address);
      const items = await db.findNewsItems(requestBody.detailsObject.maxCount);
      const reply: GetNewsResponse = {
        serverVersion: SERVER_VERSION,
        items: []
      };
      for (const item of items) {
        const ritem: NewsItem = {
          id: item.id,
          timestamp: item.timestamp,
          title: item.title,
          text: item.text,
          imageUrl: item.imageUrl,
          linkUrl: item.linkUrl
        };
        reply.items.push(ritem);
      }
      response.json(reply);
    } catch (err) {
      console.error("User.handleStatus: Failure", err);
      response.status(500).send(err);
    }
  }
}

const newsManager = new NewsManager();
export { newsManager };
