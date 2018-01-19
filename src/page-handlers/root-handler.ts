import { Request, Response, Application } from 'express';
import { RestServer } from '../interfaces/rest-server';
import { UrlManager } from '../url-manager';
import { rootPageManager } from "../root-page-manager";

export class RootPageHandler implements RestServer {

  async initializeRestServices(urlManager: UrlManager, app: Application): Promise<void> {
    app.get('/', this.handleAppPage.bind(this));
    app.get('/index.html', this.handleAppPage.bind(this));
    app.get('/index.htm', this.handleAppPage.bind(this));
    app.get('/app', this.handleAppPage.bind(this));
    app.get('/app/index.html', this.handleAppPage.bind(this));
    app.get('/app/index.htm', this.handleAppPage.bind(this));
    app.get('/*', this.handleAppPage.bind(this));
  }

  private async handleAppPage(request: Request, response: Response): Promise<void> {
    await rootPageManager.handlePage("index", request, response);
  }
}

const rootPageHandler = new RootPageHandler();
export { rootPageHandler };
