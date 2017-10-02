import path = require('path');
import fs = require('fs');
import url = require('url');
import Mustache = require('mustache');
import { Request, Response, Application } from 'express';
import { RestServer } from '../interfaces/rest-server';
import { configuration } from "../configuration";
import { UrlManager } from '../url-manager';

export class RootPageHandler implements RestServer {
  private indexContent: string;
  private appContent: string;
  private urlManager: UrlManager;
  async initializeRestServices(urlManager: UrlManager, app: Application): Promise<void> {
    this.urlManager = urlManager;
    if (!this.indexContent) {
      const indexPath = path.join(__dirname, '../../public/index.html');
      this.indexContent = fs.readFileSync(indexPath, 'utf8');
    }
    if (!this.appContent) {
      const appPath = path.join(__dirname, '../../public/app.html');
      this.appContent = fs.readFileSync(appPath, 'utf8');
    }
    app.get('/', this.handleHomePage.bind(this));
    app.get('/index.html', this.handleHomePage.bind(this));
    app.get('/index.htm', this.handleHomePage.bind(this));
    app.get('/app', this.handleRootPage.bind(this));
    app.get('/app/index.html', this.handleRootPage.bind(this));
    app.get('/app/index.htm', this.handleRootPage.bind(this));
  }

  private handleRootPage(request: Request, response: Response) {
    this.handlePage(this.appContent, request, response);
  }

  private handleHomePage(request: Request, response: Response) {
    this.handlePage(this.indexContent, request, response);
  }

  private handlePage(content: string, request: Request, response: Response) {
    const ogUrl = configuration.get('baseClientUri');
    const metadata = {
      title: "Channels",
      description: "A content network fueled by cryptocurrency. The place to get absorbed in a mix of information and entertainment where the presentation is as engaging as the content.",
      url: ogUrl,
      image: url.resolve(ogUrl, '/s/images/logo700.png'),
      imageWidth: 700,
      imageHeight: 700
    };
    const view = {
      public_base: this.urlManager.getPublicBaseUrl(),
      rest_base: this.urlManager.getDynamicBaseUrl(),
      og_title: metadata.title,
      og_description: metadata.description,
      og_url: ogUrl,
      og_image: metadata.image,
      og_imagewidth: metadata.imageWidth,
      og_imageheight: metadata.imageHeight
    };
    const output = Mustache.render(content, view);
    response.setHeader("Cache-Control", 'public, max-age=' + (1000 * 60));
    response.contentType('text/html');
    response.status(200);
    response.send(output);
  }
}

const rootPageHandler = new RootPageHandler();
export { rootPageHandler };
