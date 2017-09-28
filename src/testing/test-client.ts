import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Express, Request, Response } from 'express';
import { configuration } from '../configuration';
import { client as WebSocketClient, connection, IMessage } from 'websocket';
import { TextDecoder, TextEncoder } from 'text-encoding';
import * as url from "url";
import { RestServer } from "../interfaces/rest-server";
import { UrlManager } from "../url-manager";
import { RestRequest, RegisterUserDetails, Signable, RegisterUserResponse, UserStatusDetails, UserStatusResponse, RegisterDeviceDetails, UpdateUserIdentityDetails, UpdateUserIdentityResponse, GetUserIdentityDetails, GetUserIdentityResponse, GetNewsDetails, GetNewsResponse } from "../interfaces/rest-services";
import * as NodeRSA from "node-rsa";
import { KeyUtils } from "../key-utils";
import * as rq from 'request';
import * as fs from 'fs';
import * as path from "path";
import { PingReplyDetails, SocketMessage, PingRequestDetails, OpenRequestDetails, OpenReplyDetails, PostCardReplyDetails, PostCardDetails, GetFeedDetails, GetFeedReplyDetails } from "../interfaces/socket-messages";
import { IRestClient, PostArgs } from "../interfaces/irest-client";

const RestClient = require('node-rest-client').Client;

const APP_VERSION = "0.0.1";

class TestClient implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private restClient = new RestClient() as IRestClient;
  private keyInfo = KeyUtils.getKeyInfo(KeyUtils.generatePrivateKey());
  private socket: connection;
  private registerResponse: RegisterUserResponse;
  private requestId = 1001;
  private callbacksByRequestId: { [id: string]: (message: any) => void } = {};

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    if (configuration.get('debug.clientTester.enabled')) {
      this.app.get(this.urlManager.getDynamicUrl('test'), (request: Request, response: Response) => {
        void this.handleTest(request, response);
      });
    }
  }

  private async handleTest(request: Request, response: Response): Promise<void> {
    await this.registerUser();
    await this.registerDevice();
    await this.registerIdentity("unnamed", "user" + Date.now(), "Palo Alto, CA");
    await this.getIdentity();
    await this.getNews();
    await this.getStatus();
    await this.uploadFile();
    await this.openSocket();
    await this.sendOpen();
    await this.postCard();
    await this.getFeed();
    response.end();
  }

  private async openSocket(): Promise<void> {
    const socket = new WebSocketClient();
    return new Promise<void>((resolve, reject) => {
      socket.on('connect', (conn: connection) => {
        this.socket = conn;
        conn.on('error', (error: any) => {
          console.log("TestClient: Connection Error: " + error.toString());
        });
        conn.on('close', () => {
          console.log('TestClient: Connection Closed');
        });
        conn.on('message', (message: IMessage) => {
          if (message.type === 'utf8') {
            try {
              const jsonMsg = JSON.parse(message.utf8Data);
              void this.processSocketRxMessage(jsonMsg, conn);
            } catch (err) {
              console.error("TestClient: Invalid JSON in string message", message.utf8Data);
            }
          } else {
            console.error('TestClient: Unexpected binary-type socket message', message);
          }
        });
        resolve();
      });
      const headers: any = {};
      socket.connect(this.registerResponse.socketUrl, null, null, headers);
    });
  }

  private async processSocketRxMessage(message: any, conn: connection): Promise<void> {
    if (!message.type) {
      console.error("TestClient.processSocketRxMessage: type field missing");
      return;
    }
    switch (message.type) {
      case 'ping': {
        const pingMessage = message as SocketMessage<PingRequestDetails>;
        const details: PingReplyDetails = { success: true };
        conn.send(JSON.stringify({ type: "ping-reply", requestId: pingMessage.requestId, details: details }));
        break;
      }
      default:
        console.log("TestClient.processSocketRxMessage: RX", JSON.stringify(message));
        const requestId = message.requestId as string;
        if (requestId) {
          const callback = this.callbacksByRequestId[requestId];
          if (callback) {
            delete this.callbacksByRequestId[requestId];
            callback(message);
          }
        }
        break;
    }
  }

  private registerCallback(requestId: string, callback: (message: any) => void): void {
    this.callbacksByRequestId[requestId] = callback;
  }

  private async sendOpen(): Promise<void> {
    const signedDetails = {
      timestamp: Date.now()
    };
    const signedDetailsString = JSON.stringify(signedDetails);
    const request: SocketMessage<OpenRequestDetails> = {
      type: "open",
      requestId: (this.requestId++).toString(),
      details: {
        address: this.keyInfo.address,
        signedDetails: signedDetailsString,
        signature: KeyUtils.signString(signedDetailsString, this.keyInfo)
      }
    };
    this.socket.send(JSON.stringify(request));
    return new Promise<void>((resolve, reject) => {
      this.registerCallback(request.requestId, (message: any): void => {
        const openReply = message as SocketMessage<OpenReplyDetails>;
        if (openReply.details.success) {
          resolve();
        } else {
          reject(message);
        }
      });
    });
  }

  private async postCard(): Promise<void> {
    const request: SocketMessage<PostCardDetails> = {
      type: "post-card",
      requestId: (this.requestId++).toString(),
      details: {
        text: "Hello world " + new Date().toString(),
        promotionFee: 0,
        openFeeUnits: 1
      }
    };
    this.socket.send(JSON.stringify(request));
    return new Promise<void>((resolve, reject) => {
      this.registerCallback(request.requestId, (message: any): void => {
        const reply = message as SocketMessage<PostCardReplyDetails>;
        if (reply.details.success) {
          resolve();
        } else {
          reject(message);
        }
      });
    });
  }

  private async getFeed(): Promise<void> {
    const request: SocketMessage<GetFeedDetails> = {
      type: "get-feed",
      requestId: (this.requestId++).toString(),
      details: {
        maxCount: 5
      }
    };
    this.socket.send(JSON.stringify(request));
    return new Promise<void>((resolve, reject) => {
      this.registerCallback(request.requestId, (message: any): void => {
        const reply = message as SocketMessage<GetFeedReplyDetails>;
        if (reply.details.success) {
          resolve();
        } else {
          reject(message);
        }
      });
    });
  }

  private async registerUser(): Promise<void> {
    const details: RegisterUserDetails = {
      address: this.keyInfo.address,
      publicKey: this.keyInfo.publicKeyPem,
      timestamp: Date.now(),
      appVersion: APP_VERSION
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<RegisterUserDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("register-user: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/register-user"), args, (data: RegisterUserResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          this.registerResponse = data;
          console.log("register-user: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async getIdentity(): Promise<void> {
    const details: GetUserIdentityDetails = {
      address: this.keyInfo.address,
      timestamp: Date.now()
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<GetUserIdentityDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("get-identity: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/get-identity"), args, (data: GetUserIdentityResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("get-identity: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async getNews(): Promise<void> {
    const details: GetNewsDetails = {
      maxCount: 10,
      address: this.keyInfo.address,
      timestamp: Date.now()
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<GetNewsDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("get-news: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/get-news"), args, (data: GetNewsResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("get-news: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async getStatus(): Promise<void> {
    const details: UserStatusDetails = {
      address: this.keyInfo.address,
      timestamp: Date.now(),
      appVersion: APP_VERSION
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<UserStatusDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("status: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/account-status"), args, (data: UserStatusResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("status: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async registerDevice(): Promise<void> {
    const details: RegisterDeviceDetails = {
      address: this.keyInfo.address,
      type: "web",
      token: Math.round(Math.random() * 10000000).toFixed(0).toString(),
      timestamp: Date.now()
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<RegisterDeviceDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("register-device: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/register-device"), args, (data: UserStatusResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("register-device: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async registerIdentity(name: string, handle: string, location: string): Promise<void> {
    const details: UpdateUserIdentityDetails = {
      imageUrl: null,
      address: this.keyInfo.address,
      name: name,
      location: location,
      handle: handle,
      timestamp: Date.now()
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<UpdateUserIdentityDetails> = {
      version: 1,
      details: detailsString,
      signature: KeyUtils.signString(detailsString, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("update-identity: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/update-identity"), args, (data: UpdateUserIdentityResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("update-identity: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async uploadFile(): Promise<void> {
    console.log("uploadFile: tx");
    const postRq = rq.post(url.resolve(configuration.get('baseClientUri'), "/d/upload"), (error: any, response: rq.RequestResponse, body: any) => {
      if (error) {
        console.error("uploadFile: rx failed", error);
      } else {
        console.log("uploadFile: rx", response, body);
      }
    });
    const form = postRq.form();
    form.append("address", this.keyInfo.address);
    const ts = Date.now().toString();
    form.append("signatureTimestamp", ts);
    form.append("signature", KeyUtils.signString(ts, this.keyInfo));
    form.append("my_file", fs.createReadStream(path.join(__dirname, '../../static/images/fav2.png')), {
      filename: 'fav2.png',
      contentType: 'image/png'
    });
  }
}

const testClient = new TestClient();

export { testClient };
