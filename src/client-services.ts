import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { SERVER_VERSION } from "./server-version";
import { RestRequest, QueryPageDetails, QueryPageResponse } from "./interfaces/rest-services";
import fetch from "node-fetch";

export class ClientServices implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('query-page'), (request: Request, response: Response) => {
      void this.handleQueryPage(request, response);
    });
  }
  private async handleQueryPage(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<QueryPageDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("ClientServices.query-page", user.id, requestBody.detailsObject);
      let embeddable = true;
      let notEmbeddableReason = null;
      try {
        const fetchResponse = await fetch(requestBody.detailsObject.url);
        const xFrameOption = fetchResponse.headers.get('x-frame-options');
        if (xFrameOption && (xFrameOption.toLowerCase() === 'deny' || xFrameOption.toLowerCase() === 'sameorigin')) {
          embeddable = false;
          notEmbeddableReason = "This page does not permit embedding";
        }
      } catch (err) {
        embeddable = false;
        notEmbeddableReason = "This page is not available";
      }
      const reply: QueryPageResponse = {
        serverVersion: SERVER_VERSION,
        embeddable: embeddable,
        notEmbeddableReason: notEmbeddableReason
      };
      response.json(reply);
    } catch (err) {
      console.error("ClientServices.handleQueryPage: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const clientServices = new ClientServices();

export { clientServices };
