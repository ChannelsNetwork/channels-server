import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { db } from "./db";
import { SERVER_VERSION } from "./server-version";
import { UrlManager } from "./url-manager";
import { RestRequest, SearchDetails, SearchResponse, SearchMoreCardsDetails, SearchMoreCardsResponse, SearchMoreChannelsResponse, SearchMoreChannelsDetails } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import { errorManager } from "./error-manager";
import { feedManager } from "./feed-manager";
import { channelManager } from "./channel-manager";

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
    this.app.post(this.urlManager.getDynamicUrl('search-more-cards'), (request: Request, response: Response) => {
      void this.handleSearchMoreCards(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('search-more-channels'), (request: Request, response: Response) => {
      void this.handleSearchMoreChannels(request, response);
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
      const cardResults = await feedManager.searchCards(request, user, requestBody.detailsObject.searchString, 0, requestBody.detailsObject.limitCards);
      const channelResults = await channelManager.searchChannels(user, requestBody.detailsObject.searchString, 0, requestBody.detailsObject.limitChannels);
      const reply: SearchResponse = {
        serverVersion: SERVER_VERSION,
        cardResults: cardResults,
        channelResults: channelResults
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("Search.handleSearch: Failure", request, err);
      response.status(err.code && err.code >= 400 ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleSearchMoreCards(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<SearchMoreCardsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.searchString) {
        response.status(400).send("Missing search string");
        return;
      }
      console.log("SearchManager.handleSearchMoreCards", requestBody.detailsObject);
      const cardResults = await feedManager.searchCards(request, user, requestBody.detailsObject.searchString, requestBody.detailsObject.skip, requestBody.detailsObject.limit);
      const reply: SearchMoreCardsResponse = {
        serverVersion: SERVER_VERSION,
        cardResults: cardResults
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("Search.handleSearchMoreCards: Failure", request, err);
      response.status(err.code && err.code >= 400 ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleSearchMoreChannels(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<SearchMoreChannelsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.searchString) {
        response.status(400).send("Missing search string");
        return;
      }
      console.log("SearchManager.handleSearchMoreChannels", requestBody.detailsObject);
      const result = await channelManager.searchChannels(user, requestBody.detailsObject.searchString, requestBody.detailsObject.skip, requestBody.detailsObject.limit);
      const reply: SearchMoreChannelsResponse = {
        serverVersion: SERVER_VERSION,
        channelResults: result
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("Search.handleSearchMoreChannels: Failure", request, err);
      response.status(err.code && err.code >= 400 ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const searchManager = new SearchManager();

export { searchManager };
