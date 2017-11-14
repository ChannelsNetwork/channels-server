import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { SERVER_VERSION } from "./server-version";
import { UrlManager } from "./url-manager";
import { RestRequest, SearchDetails, SearchResponse } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import { feedManager } from "./feed-manager";

export class SearchManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('search'), (request: Request, response: Response) => {
      void this.handleSearch(request, response);
    });
  }

  private async handleSearch(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<SearchDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("SearchManager.search", requestBody.detailsObject);
      const cards = await feedManager.search(user, requestBody.detailsObject.searchString, requestBody.detailsObject.limit);
      const reply: SearchResponse = {
        serverVersion: SERVER_VERSION,
        cards: cards
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetFeed: Failure", err);
      response.status(err.code && err.code >= 400 ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const searchManager = new SearchManager();

export { searchManager };
