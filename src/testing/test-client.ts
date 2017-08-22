import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Express, Request, Response } from 'express';
import { configuration } from '../configuration';
import { client as WebSocketClient, connection, IMessage } from 'websocket';
import { TextDecoder, TextEncoder } from 'text-encoding';
import * as url from "url";
import { RestServer } from "../interfaces/rest-server";
import { UrlManager } from "../url-manager";
import { RestRequest, RegisterUserDetails, Signable, RegisterUserResponse, UserStatusDetails, UserStatusResponse, RegisterIosDeviceDetails, PostCardDetails, PostCardResponse, GetFeedDetails, GetFeedResponse, UpdateUserIdentityDetails, UpdateUserIdentityResponse } from "../interfaces/rest-services";
import * as NodeRSA from "node-rsa";
import { KeyUtils } from "../key-utils";
import * as rq from 'request';
import * as fs from 'fs';
import * as path from "path";

const RestClient = require('node-rest-client').Client;

class TestClient implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private restClient = new RestClient() as IRestClient;
  private keyInfo = KeyUtils.getKeyInfo(KeyUtils.generatePrivateKey());

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
    await this.registerIosDevice();
    await this.registerIdentity("unnamed", "user" + Date.now());
    await this.getStatus();
    await this.postCard("hello world at " + new Date().toString());
    await this.getFeed();
    await this.uploadFile();
    response.end();
  }

  private async registerUser(): Promise<void> {
    const details: RegisterUserDetails = {
      address: this.keyInfo.address,
      publicKey: this.keyInfo.publicKeyPem,
      timestamp: Date.now()
    };
    const request: RestRequest<RegisterUserDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
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
          console.log("register-user: rx:", JSON.stringify(data, null, 2));
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
      timestamp: Date.now()
    };
    const request: RestRequest<UserStatusDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
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

  private async registerIosDevice(): Promise<void> {
    const details: RegisterIosDeviceDetails = {
      address: this.keyInfo.address,
      deviceToken: Math.round(Math.random() * 10000000).toFixed(0).toString(),
      timestamp: Date.now()
    };
    const request: RestRequest<RegisterIosDeviceDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("register-ios-device: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/register-ios-device"), args, (data: UserStatusResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("register-ios-device: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async registerIdentity(name: string, handle: string): Promise<void> {
    const details: UpdateUserIdentityDetails = {
      address: this.keyInfo.address,
      name: name,
      handle: handle,
      timestamp: Date.now()
    };
    const request: RestRequest<UpdateUserIdentityDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
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

  private async postCard(text: string): Promise<void> {
    const details: PostCardDetails = {
      address: this.keyInfo.address,
      text: text,
      cardType: "none",
      state: null,
      timestamp: Date.now()
    };
    const request: RestRequest<PostCardDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("post-card: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/post-card"), args, (data: PostCardResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("post-card: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async getFeed(): Promise<void> {
    const details: GetFeedDetails = {
      address: this.keyInfo.address,
      maxCount: 5,
      timestamp: Date.now()
    };
    const request: RestRequest<GetFeedDetails> = {
      version: 1,
      details: details,
      signature: KeyUtils.sign(details, this.keyInfo)
    };
    const args: PostArgs = {
      data: request,
      headers: {
        "Content-Type": "application/json"
      }
    };
    console.log("feed: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/feed"), args, (data: GetFeedResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("feed: rx:", JSON.stringify(data, null, 2));
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
    form.append("my_file", fs.createReadStream(path.join(__dirname, '../../static/images/icons8-external-link.svg')), {
      filename: 'icons8-external-link.svg',
      contentType: 'text/svg'
    });
  }
}

interface PostArgs {
  data: any;
  headers: { [name: string]: string };
}
interface RestArgs {
  headers: { [name: string]: string };
}

interface IRestClient {
  get(url: string, callback: (data: any, response: Response) => void): void;

  get(url: string, args: RestArgs, callback: (data: any, response: Response) => void): void;
  post(url: string, args: PostArgs, callback: (data: any, response: Response) => void): void;
  delete(url: string, args: RestArgs, callback: (data: any, response: Response) => void): void;
}

const testClient = new TestClient();

export { testClient };
