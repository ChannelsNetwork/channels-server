import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Express, Request, Response, NextFunction } from 'express';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as path from "path";
import * as fs from 'fs';
import * as url from 'url';

import { configuration } from "./configuration";
import { db } from './db';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from './url-manager';
import { rootPageHandler } from './page-handlers/root-handler';

const VERSION = 1;

class ChannelsNetworkWebClient {
  private app: express.Application;
  private server: net.Server;
  private expressWs: any;
  private started: number;
  private restServers: RestServer[] = [rootPageHandler];
  private urlManager: UrlManager;

  constructor() {
    this.urlManager = new UrlManager(VERSION);
  }

  async start(): Promise<void> {
    this.setupExceptionHandling();
    await this.setupConfiguration();
    await db.initialize();
    await this.setupExpress();
    await this.setupServerPing();
    this.started = Date.now();

    console.log("Channels Network Web Client is running");

  }

  private setupExceptionHandling(): void {
    process.on('exit', (code: any) => {
      console.log(`About to exit with code: ${code}`);
    });

    const onExit = require('signal-exit');

    onExit((code: any, signal: any) => {
      console.log('process exiting!');
      console.log(code, signal);
    });

    process.on('unhandledRejection', (reason: any) => {
      console.error("Unhandled Rejection!", JSON.stringify(reason), reason.stack);
    });

    process.on('uncaughtException', (err: any) => {
      console.error("Unhandled Exception!", err.toString(), err.stack);
    });
  }

  private async setupConfiguration(): Promise<void> {
    for (let i = 0; i < process.argv.length - 1; i++) {
      if (process.argv[i] === '-c') {
        await configuration.load(process.argv[i + 1]);
        return;
      }
    }
    await configuration.load('./config.json');
  }

  private async setupExpress(): Promise<void> {
    this.app = express();

    this.app.use(compression());
    this.app.use(bodyParser.json()); // for parsing application/json
    this.app.use(bodyParser.urlencoded({
      extended: true
    }));
    this.app.use(cookieParser());

    for (const restServer of this.restServers) {
      await restServer.initializeRestServices(this.urlManager, this.app);
    }

    this.app.use('/v' + VERSION, express.static(path.join(__dirname, '../public'), { maxAge: 1000 * 60 * 60 * 24 * 30 }));
    this.app.use('/s', express.static(path.join(__dirname, "../static"), { maxAge: 1000 * 60 * 60 * 24 * 30 }));
    if (configuration.get('client.ssl')) {
      const privateKey = fs.readFileSync(configuration.get('ssl.key'), 'utf8');
      const certificate = fs.readFileSync(configuration.get('ssl.cert'), 'utf8');
      const credentials: any = {
        key: privateKey,
        cert: certificate
      };
      const ca = this.getCertificateAuthority();
      if (ca) {
        credentials.ca = ca;
      }
      this.server = https.createServer(credentials, this.app);
    } else {
      this.server = http.createServer(this.app);
    }
    this.server.listen(configuration.get('client.port'), (err: any) => {
      if (err) {
        console.error("Failure listening", err);
        process.exit();
      } else {
        console.log("Listening for client connections on port " + configuration.get('client.port'));
      }
    });
  }

  private getCertificateAuthority(): string[] {
    let ca: string[];
    if (configuration.get('ssl.ca')) {
      ca = [];
      const chain = fs.readFileSync(configuration.get('ssl.ca'), 'utf8');
      const chains = chain.split("\n");
      let cert: string[] = [];
      for (const line of chains) {
        if (line.length > 0) {
          cert.push(line);
          if (line.match(/-END CERTIFICATE-/)) {
            ca.push(cert.join('\n'));
            cert = [];
          }
        }
      }
    }
    return ca;
  }

  private setupServerPing(): void {
    this.app.get('/ping', (request: Request, response: Response) => {
      response.setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
      response.setHeader('Content-Type', 'application/json');
      const result: any = {
        product: 'Channel-Elements-Web-Client-Server',
        status: 'OK',
        version: VERSION,
        deployed: new Date(this.started).toISOString(),
        server: configuration.get('serverId')
      };
      response.json(result);
    });
  }

}

const server = new ChannelsNetworkWebClient();

void server.start();
