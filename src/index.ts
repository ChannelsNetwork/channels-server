import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response, NextFunction } from 'express';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import * as compression from "compression";
import * as bodyParser from "body-parser";
import * as cookieParser from "cookie-parser";
import * as path from "path";
import * as fs from 'fs';

import { configuration } from "./configuration";
import { db } from './db';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from './url-manager';
import { rootPageHandler } from './page-handlers/root-handler';
import { userManager } from "./user-manager";
import { feedManager } from "./feed-manager";
import { cardManager } from "./card-manager";
import { fileManager } from "./file-manager";
import { newsManager } from "./news-manager";
import { testClient } from "./testing/test-client";
import { awsManager } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { ExpressWithSockets, SocketConnectionHandler } from "./interfaces/express-with-sockets";
import { socketServer } from "./socket-server";
import { mediumManager } from "./medium-manager";
import { priceRegulator } from "./price-regulator";
import { channelsComponentManager } from "./channels-component-manager";
import { networkEntity } from "./network-entity";
import { bank } from "./bank";

const VERSION = 14;
const INITIAL_NETWORK_BALANCE = 25000;

class ChannelsNetworkWebClient {
  private app: express.Application;
  private server: net.Server;
  private started: number;
  private initializables: Initializable[] = [networkEntity, awsManager, cardManager, feedManager, priceRegulator, userManager];
  private restServers: RestServer[] = [rootPageHandler, userManager, testClient, fileManager, awsManager, newsManager, mediumManager, channelsComponentManager, cardManager, feedManager, bank];
  private socketServers: SocketConnectionHandler[] = [socketServer];
  private urlManager: UrlManager;
  private wsapp: ExpressWithSockets;

  constructor() {
    this.urlManager = new UrlManager(VERSION);
  }

  async start(): Promise<void> {
    this.setupExceptionHandling();
    await this.setupConfiguration();
    await db.initialize();
    for (const initializable of this.initializables) {
      await initializable.initialize(this.urlManager);
    }
    await this.setupExpress();

    require('express-ws')(this.app, this.server);
    this.wsapp = this.app as ExpressWithSockets;

    for (const sserver of this.socketServers) {
      await sserver.initializeWebsocketServices(this.urlManager, this.wsapp);
    }

    for (const initializable of this.initializables) {
      await initializable.initialize2();
    }
    await this.setupServerPing();
    this.started = Date.now();

    console.log("Channels Network Server is running");
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
    await configuration.load(path.join(__dirname, '../config.json'));
  }

  private async setupExpress(): Promise<void> {
    this.app = express();

    this.app.use(compression());
    this.app.use(bodyParser.json({ strict: false })); // for parsing application/json
    this.app.use(bodyParser.urlencoded({
      extended: true
    }));
    // this.app.use((req: Request, res: Response, next: NextFunction) => {
    //   res.setHeader("Access-Control-Allow-Origin", "*");
    //   res.setHeader("Access-Control-Allow-Credentials", "true");
    //   if (req.method.toLowerCase() === "options") {
    //     res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    //     const requestedHeaders = req.header("Access-Control-Request-Headers");
    //     if (requestedHeaders) {
    //       res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
    //     }
    //   }
    //   next();
    // });
    // this.app.use((req: any, res: any, next: any) => {
    //   if (req.is('text/*')) {
    //     req.text = '';
    //     req.setEncoding('utf8');
    //     req.on('data', (chunk: any) => { req.text += chunk; });
    //     req.on('end', next);
    //   } else {
    //     next();
    //   }
    // });
    this.app.use(cookieParser());

    for (const restServer of this.restServers) {
      await restServer.initializeRestServices(this.urlManager, this.app);
    }

    this.app.use('/app/terms.html', express.static(path.join(__dirname, "../public/terms.html"), { maxAge: 1000 * 60 }));
    this.app.use('/whitepaper.pdf', express.static(path.join(__dirname, "../public/whitepaper.pdf"), { maxAge: 1000 * 60 * 15 }));
    this.app.use('/manifest.json', express.static(path.join(__dirname, "../public/manifest.json"), { maxAge: 0 }));
    this.app.use('/OneSignalSDKWorker.js', express.static(path.join(__dirname, "../public/OneSignalSDKWorker.js"), { maxAge: 1000 * 60 * 60 * 24 }));
    this.app.use('/OneSignalSDKUpdaterWorker.js', express.static(path.join(__dirname, "../public/OneSignalSDKUpdaterWorker.js"), { maxAge: 1000 * 60 * 60 * 24 }));

    this.app.use('/v' + VERSION, express.static(path.join(__dirname, '../public'), { maxAge: 1000 * 60 * 60 * 24 }));
    this.app.use('/s', express.static(path.join(__dirname, "../static"), { maxAge: 1000 * 60 * 60 * 24 }));
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
