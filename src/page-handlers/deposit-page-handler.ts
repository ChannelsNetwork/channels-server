import path = require('path');
import fs = require('fs');
import url = require('url');
import Mustache = require('mustache');
import { Request, Response, Application } from 'express';
import { RestServer } from '../interfaces/rest-server';
import { configuration } from "../configuration";
import { UrlManager } from '../url-manager';

export class DepositPageHandler implements RestServer {
  private content: string;
  private appContent: string;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: Application): Promise<void> {
    this.urlManager = urlManager;
    if (!this.content) {
      const contentPath = path.join(__dirname, '../../public/deposit-page.html');
      this.content = fs.readFileSync(contentPath, 'utf8');
    }
    app.get(this.urlManager.getPublicUrl('deposit'), this.handleDepositPage.bind(this));
  }

  private handleDepositPage(request: Request, response: Response) {
    const ogUrl = configuration.get('baseClientUri');
    const view = {
      public_base: this.urlManager.getPublicBaseUrl(),
      rest_base: this.urlManager.getDynamicBaseUrl(),
      analyticsId: configuration.get('google.analytics.id')
    };
    const output = Mustache.render(this.content, view);
    response.setHeader("Cache-Control", 'public, max-age=' + 60);
    response.contentType('text/html');
    response.status(200);
    response.send(output);
  }
}

const depositPageHandler = new DepositPageHandler();
export { depositPageHandler };
