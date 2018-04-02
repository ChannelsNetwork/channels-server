import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { configuration } from "./configuration";
import * as url from 'url';
import { SERVER_VERSION } from "./server-version";
import { RestRequest, ShortenUrlDetails, ShortenUrlResponse } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import { errorManager } from "./error-manager";
import { db } from "./db";

const LETTERS = 'abcdefghjklmnpqrstuvwxyz';
const DIGITS = '0123456789';
const URL_SYMBOLS = '-._~';
const CODE_SYMBOLS = LETTERS + LETTERS.toUpperCase() + DIGITS + URL_SYMBOLS;

export class UrlManager implements RestServer {
  private version: number;
  private app: express.Application;
  constructor(version: number) {
    this.version = version;
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.getDynamicUrl('shorten-url'), (request: Request, response: Response) => {
      void this.handleShortenUrl(request, response);
    });
    this.app.get('/u/:code', (request: Request, response: Response) => {
      void this.handleShortUrl(request, response);
    });
  }

  getAbsoluteUrl(relativeUrl: string): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl += '/';
    }
    return configuration.get('baseClientUri') + relativeUrl;
  }

  getPublicBaseUrl(absolute = false): string {
    const baseUrl = '/v' + this.version;
    if (absolute) {
      return configuration.get('baseClientUri') + baseUrl;
    }
    return baseUrl;
  }

  getDynamicBaseUrl(absolute = false): string {
    if (absolute) {
      return configuration.get('baseClientUri') + '/d';
    } else {
      return '/d';
    }
  }

  getBowerComponentBaseUrl(absolute = false): string {
    const baseUrl = '/v' + this.version + "/bower_components/";
    if (absolute) {
      return configuration.get('baseClientUri') + baseUrl;
    }
    return baseUrl;
  }

  getStaticBaseUrl(absolute = false): string {
    if (absolute) {
      return configuration.get('baseClientUri') + '/s';
    } else {
      return '/s';
    }
  }

  getStaticUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/s' + relativeUrl;
    } else {
      return '/s' + relativeUrl;
    }
  }

  getDynamicUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/d' + relativeUrl;
    } else {
      return '/d' + relativeUrl;
    }
  }

  getBowerComponentUrl(relativeUrl: string): string {
    return url.resolve(this.getBowerComponentBaseUrl(), relativeUrl);
  }

  getPublicUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    return this.getPublicBaseUrl(absolute) + relativeUrl;
  }

  getVersionedUrl(relativeUrl: string, absolute = false): string {
    if (!relativeUrl.startsWith('/')) {
      relativeUrl = '/' + relativeUrl;
    }
    if (absolute) {
      return configuration.get('baseClientUri') + '/v' + this.version + relativeUrl;
    } else {
      return '/d' + relativeUrl;
    }
  }

  getSocketUrl(relativeUrl: string): string {
    return configuration.get('baseSocketUri') + '/d/' + relativeUrl;
  }

  private async handleShortenUrl(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ShortenUrlDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.url) {
        response.status(400).send("Missing Url");
        return;
      }
      const code = await this.generateUniqueRandomShortCode(request, requestBody.detailsObject.url, user.id, requestBody.sessionId);
      const shortUrl = this.getAbsoluteUrl('/u/' + code);
      console.log("UrlManager.shorten-url", requestBody.detailsObject);
      const reply: ShortenUrlResponse = {
        serverVersion: SERVER_VERSION,
        shortUrl: shortUrl
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetShortUrl: Failure", request, request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleShortUrl(request: Request, response: Response): Promise<void> {
    const code = request.params.code;
    const record = await db.findShortUrlByCode(code);
    if (!record) {
      response.status(404).send("No such short code");
      return;
    }
    response.redirect(record.originalUrl);
  }

  private async generateUniqueRandomShortCode(request: Request, originalUrl: string, byId: string, sessionId: string): Promise<string> {
    while (true) {
      let result = "";
      for (let i = 0; i < 5; i++) {
        result += CODE_SYMBOLS[Math.floor(Math.random() * CODE_SYMBOLS.length)];
      }
      const existing = await db.findShortUrlByCode(result);
      if (!existing) {
        try {
          await db.insertShortUrl(result, originalUrl, byId, sessionId);
          return result;
        } catch (err) {
          errorManager.warning("UrlManager.generateUniqueRandomShortCode: race condition", request, result);
        }
      }
    }
  }
}
