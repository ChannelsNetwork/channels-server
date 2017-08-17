import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Express, Request, Response } from 'express';
import { configuration } from '../configuration';
import { client as WebSocketClient, connection, IMessage } from 'websocket';
import { TextDecoder, TextEncoder } from 'text-encoding';
import * as url from "url";
import { RestServer } from "../interfaces/rest-server";
import { UrlManager } from "../url-manager";
import { RestRequest, RegisterUserDetails, Signable, RegisterUserResponse, UserStatusDetails, UserStatusResponse, RegisterIosDeviceDetails } from "../interfaces/rest-services";
import * as NodeRSA from "node-rsa";
import { KeyUtils } from "../key-utils";

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
    await this.getStatus();
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
