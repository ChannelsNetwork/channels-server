import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
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
import { fileManager } from "./file-manager";
import { testClient } from "./testing/test-client";

const VERSION = 3;
const INITIAL_NETWORK_BALANCE = 25000;

class ChannelsNetworkWebClient {
  private app: express.Application;
  private httpServer: net.Server;
  private httpsServer: net.Server;
  private started: number;
  private restServers: RestServer[] = [rootPageHandler, userManager, testClient, feedManager, fileManager];
  private urlManager: UrlManager;

  constructor() {
    this.urlManager = new UrlManager(VERSION);
  }

  async start(): Promise<void> {
    this.setupExceptionHandling();
    await this.setupConfiguration();
    await db.initialize();
    await this.ensureNetwork();
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
    await configuration.load(path.join(__dirname, '../config.json'));
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
    if (configuration.get('client.httpPort')) {
      this.httpServer = http.createServer(this.app);
      this.httpServer.listen(configuration.get('client.httpPort'), (err: any) => {
        if (err) {
          console.error("Failure listening on HTTP", err);
          process.exit();
        } else {
          console.log("Listening for HTTP client connections on port " + configuration.get('client.httpPort'));
        }
      });
    }
    if (configuration.get('client.httpsPort')) {
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
      this.httpsServer = https.createServer(credentials, this.app);
      this.httpsServer.listen(configuration.get('client.httpsPort'), (err: any) => {
        if (err) {
          console.error("Failure listening on HTTPS", err);
          process.exit();
        } else {
          console.log("Listening for HTTPS client connections on port " + configuration.get('client.httpsPort'));
        }
      });
    }
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

  private async ensureNetwork(): Promise<void> {
    const network = await db.getNetwork();
    if (!network) {
      await db.insertNetwork(INITIAL_NETWORK_BALANCE);
    }
  }
}

const server = new ChannelsNetworkWebClient();

void server.start();
