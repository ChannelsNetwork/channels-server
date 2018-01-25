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
import { errorManager } from "./error-manager";
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
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.searchString) {
        response.status(400).send("Missing search string");
        return;
      }
      console.log("SearchManager.search", requestBody.detailsObject);
      const result = await feedManager.search(request, user, requestBody.detailsObject.searchString, requestBody.detailsObject.skip, requestBody.detailsObject.limit, requestBody.detailsObject.existingPromotedCardIds);
      const reply: SearchResponse = {
        serverVersion: SERVER_VERSION,
        cards: result.cards,
        moreAvailable: result.moreAvailable,
        nextSkip: (requestBody.detailsObject.skip || 0) + result.cards.length
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetFeed: Failure", err);
      response.status(err.code && err.code >= 400 ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const searchManager = new SearchManager();

export { searchManager };
