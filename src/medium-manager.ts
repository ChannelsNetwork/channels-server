import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import fetch from "node-fetch";
import { errorManager } from "./error-manager";
// import * as cheerio from "cheerio";
// const htmlencode = require('htmlencode');

const MEDIUM_PREFIX = '])}while(1);</x>';

// This provides a service for fetching JSON content from Medium useful to clients
// that need content from Medium, but can't fetch it directly because of CORS
// restrictions.

export class MediumManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.get(this.urlManager.getDynamicUrl('medium-load'), (request: Request, response: Response) => {
      void this.handleMediumLoad(request, response);
    });
  }
  private async handleMediumLoad(request: Request, response: Response): Promise<void> {
    try {
      const url = request.query.url;
      if (!url) {
        response.status(400).send("Missing url parameter");
        return;
      }
      await this.loadMedium(url, response);
    } catch (err) {
      errorManager.error("Medium.handleMediumLoad: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async loadMedium(url: string, response: Response): Promise<void> {
    if (url.indexOf("?") < 0) {
      url = url + "?format=json";
    }
    const result = await fetch(url);
    let body = await result.text();
    if (body && body.indexOf(MEDIUM_PREFIX) >= 0) {
      body = body.replace(MEDIUM_PREFIX, '');
      const content = JSON.parse(body) as MediumArticle;
      response.json(content);
      // const formattedContent = await this.formatMediumArticle(content);
      // response.header('Content-Type', 'text/html');
      // response.status(200).send(formattedContent);
    } else {
      response.status(503).send("Did not receive valid response");
    }
  }

  // private async formatMediumArticle(article: MediumArticle): Promise<string> {
  //   const doc = cheerio.load('<div class="container"></div>');
  //   if (article && article.payload && article.payload.value && article.payload.value.content && article.payload.value.content.bodyModel.paragraphs) {
  //     for (const paragraph of article.payload.value.content.bodyModel.paragraphs) {
  //       doc('.container').append('<p>' + htmlencode.htmlEncode(paragraph.text) + '</p>');
  //     }
  //   }
  //   return doc.html();
  // }

}

interface MediumArticle {
  success: boolean;
  b: string;
  v: number;
  payload: {
    value: {
      id: string;
      content: {
        bodyModel: {
          paragraphs: MediumParagraph[];
          sections: MediumSection[];
        };
        metaDescription: string;
        postDisplay: {
          coverless: boolean;
        };
        subtitle: string;
      };
      title: string;
      type: string;
      mediumUrl: string;
    };
  };
}

interface MediumParagraph {
  name: string;
  type: number;
  text: string;
  markups: MediumMarkup[];
  layout: number;
  metadata: {
    id: string;
    originalWidth: number;
    originalHeight: number;
  };
  href?: string;
  iframe?: {
    iframeHeight: number;
    iframeWidth: number;
    mediaResourceId: string;
    thumbnailUrl: string;
  };
}

interface MediumMarkup {
  type: number;
  start: number;
  end: number;
}

interface MediumSection {
  name: string;
  startIndex: number;
}

const mediumManager = new MediumManager();

export { mediumManager };
