const Rollbar = require('rollbar');
import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { RestServer } from "./interfaces/rest-server";
import { UrlManager } from "./url-manager";
import { configuration } from "./configuration";

export class ErrorManager implements RestServer {
  private rollbar: any;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    const rollbarToken = configuration.get('rollbar.token');
    if (rollbarToken) {
      console.log("ErrorManager.initializeRestServices:  Starting Rollbar");
      this.rollbar = new Rollbar(rollbarToken);
      app.use(this.rollbar.errorHandler());
      this.rollbar.log("ErrorManager: channels server starting up", configuration.get('serverId'));
    } else {
      console.warn("ErrorManager.initializeRestServices:  Rollbar is not running");
    }
  }

  info(message: string, request: Request, ...more: any[]): void {
    if (this.rollbar) {
      this.rollbar.log(message, request, ...more);
    }
    console.info(message, request ? (request as any).user : null, ...more);
  }

  warning(message: string, request: Request, ...more: any[]): void {
    if (this.rollbar) {
      this.rollbar.warning(message, request, ...more);
    }
    console.warn(message, request ? (request as any).user : null, ...more);
  }

  error(message: string, request: Request, ...more: any[]): void {
    if (this.rollbar) {
      this.rollbar.error(message, request, ...more);
    }
    console.error(message, request ? (request as any).user : null, ...more);
  }

  critical(message: string, request: Request, ...more: any[]): void {
    if (this.rollbar) {
      this.rollbar.critical(message, request, ...more);
    }
    console.error(message, request ? (request as any).user : null, ...more);
  }

}

const errorManager = new ErrorManager();

export { errorManager };
