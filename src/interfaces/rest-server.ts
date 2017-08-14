import { Application } from 'express';
import { UrlManager } from '../url-manager';

export interface RestServer {
  initializeRestServices(urlManager: UrlManager, app: Application): Promise<void>;
}
