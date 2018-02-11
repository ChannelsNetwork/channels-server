import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Express, Request, Response } from 'express';
import { configuration } from '../configuration';
import { TextDecoder, TextEncoder } from 'text-encoding';
import * as url from "url";
import { RestServer } from "../interfaces/rest-server";
import { UrlManager } from "../url-manager";
import { RestRequest, RegisterUserDetails, Signable, RegisterUserResponse, UserStatusDetails, UserStatusResponse, UpdateUserIdentityDetails, UpdateUserIdentityResponse, GetUserIdentityDetails, GetUserIdentityResponse, EnsureChannelComponentDetails, ChannelComponentResponse, GetFeedsDetails, PostCardDetails, CardImpressionDetails, GetFeedsResponse, PostCardResponse, CardImpressionResponse, CardOpenedDetails, CardOpenedResponse, CardPayDetails, CardPayResponse, CardClosedDetails, CardClosedResponse, UpdateCardLikeDetails, UpdateCardLikeResponse, BankTransactionDetails, CardDescriptor, GetCardDetails, GetCardResponse } from "../interfaces/rest-services";
import * as NodeRSA from "node-rsa";
import { KeyUtils } from "../key-utils";
import * as rq from 'request';
import * as fs from 'fs';
import * as path from "path";
import { IRestClient, PostArgs } from "../interfaces/irest-client";

const RestClient = require('node-rest-client').Client;

const APP_VERSION = "0.0.1";

class TestClient implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private restClient = new RestClient() as IRestClient;
  private keyInfo = KeyUtils.getKeyInfo(KeyUtils.generatePrivateKey());
  private registerResponse: RegisterUserResponse;
  private requestId = 1001;
  private postedCardId: string;
  private fetchedCard: CardDescriptor;

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
    await this.registerIdentity("unnamed", "user" + Date.now(), "Palo Alto, CA");
    await this.getIdentity();
    // await this.getNews();
    await this.getStatus();
    await this.getFeed();
    await this.installCard();
    await this.uploadFile();
    await this.postCard();
    await this.getCard(this.postedCardId);
    await this.cardImpression(this.fetchedCard.id);
    await this.cardOpened(this.fetchedCard.id);
    await this.cardPay(this.fetchedCard);
    await this.cardClosed(this.fetchedCard.id);
    await this.getCard(this.postedCardId);
    await this.getFeed();
    response.end();
  }

  // private async openSocket(): Promise<void> {
  //   const socket = new WebSocketClient();
  //   return new Promise<void>((resolve, reject) => {
  //     socket.on('connect', (conn: connection) => {
  //       this.socket = conn;
  //       conn.on('error', (error: any) => {
  //         console.log("TestClient: Connection Error: " + error.toString());
  //       });
  //       conn.on('close', () => {
  //         console.log('TestClient: Connection Closed');
  //       });
  //       conn.on('message', (message: IMessage) => {
  //         if (message.type === 'utf8') {
  //           try {
  //             const jsonMsg = JSON.parse(message.utf8Data);
  //             void this.processSocketRxMessage(jsonMsg, conn);
  //           } catch (err) {
  //             errorManager.error("TestClient: Invalid JSON in string message", message.utf8Data);
  //           }
  //         } else {
  //           errorManager.error('TestClient: Unexpected binary-type socket message', message);
  //         }
  //       });
  //       resolve();
  //     });
  //     const headers: any = {};
  //     socket.connect(this.registerResponse.socketUrl, null, null, headers);
  //   });
  // }

  // private async processSocketRxMessage(message: any, conn: connection): Promise<void> {
  //   if (!message.type) {
  //     errorManager.error("TestClient.processSocketRxMessage: type field missing");
  //     return;
  //   }
  //   switch (message.type) {
  //     case 'ping': {
  //       const pingMessage = message as SocketMessage<PingRequestDetails>;
  //       const details: PingReplyDetails = { success: true };
  //       conn.send(JSON.stringify({ type: "ping-reply", requestId: pingMessage.requestId, details: details }));
  //       break;
  //     }
  //     default:
  //       console.log("TestClient.processSocketRxMessage: RX", JSON.stringify(message));
  //       const requestId = message.requestId as string;
  //       if (requestId) {
  //         const callback = this.callbacksByRequestId[requestId];
  //         if (callback) {
  //           delete this.callbacksByRequestId[requestId];
  //           callback(message);
  //         }
  //       }
  //       break;
  //   }
  // }

  // private registerCallback(requestId: string, callback: (message: any) => void): void {
  //   this.callbacksByRequestId[requestId] = callback;
  // }

  // private async sendOpen(): Promise<void> {
  //   const signedDetails = {
  //     timestamp: Date.now()
  //   };
  //   const signedDetailsString = JSON.stringify(signedDetails);
  //   const request: SocketMessage<OpenRequestDetails> = {
  //     type: "open",
  //     requestId: (this.requestId++).toString(),
  //     details: {
  //       address: this.keyInfo.address,
  //       signedDetails: signedDetailsString,
  //       signature: KeyUtils.signString(signedDetailsString, this.keyInfo)
  //     }
  //   };
  //   this.socket.send(JSON.stringify(request));
  //   return new Promise<void>((resolve, reject) => {
  //     this.registerCallback(request.requestId, (message: any): void => {
  //       const openReply = message as SocketMessage<OpenReplyDetails>;
  //       if (openReply.details.success) {
  //         resolve();
  //       } else {
  //         reject(message);
  //       }
  //     });
  //   });
  // }

  private async installCard(): Promise<void> {
    const details: EnsureChannelComponentDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      package: "ChannelElementsTeam/card-sample-hello-world"
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<EnsureChannelComponentDetails> = {
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
    console.log("ensure-component: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/ensure-component"), args, (data: ChannelComponentResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("ensure-component: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  // private async getFeed(): Promise<void> {
  //   const request: SocketMessage<GetFeedDetails> = {
  //     type: "get-feed",
  //     requestId: (this.requestId++).toString(),
  //     details: {
  //       maxCount: 5
  //     }
  //   };
  //   this.socket.send(JSON.stringify(request));
  //   return new Promise<void>((resolve, reject) => {
  //     this.registerCallback(request.requestId, (message: any): void => {
  //       const reply = message as SocketMessage<GetFeedReplyDetails>;
  //       if (reply.details.success) {
  //         resolve();
  //       } else {
  //         reject(message);
  //       }
  //     });
  //   });
  // }

  private async registerUser(): Promise<void> {
    const details: RegisterUserDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      publicKey: this.keyInfo.publicKeyPem,
      timestamp: Date.now(),
      referrer: null,
      landingUrl: null,
      userAgent: null
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
      fingerprint: null,
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

  // private async getNews(): Promise<void> {
  //   const details: GetNewsDetails = {
  //     maxCount: 10,
  //     address: this.keyInfo.address,
  //     timestamp: Date.now()
  //   };
  //   const detailsString = JSON.stringify(details);
  //   const request: RestRequest<GetNewsDetails> = {
  //     version: 1,
  //     details: detailsString,
  //     signature: KeyUtils.signString(detailsString, this.keyInfo)
  //   };
  //   const args: PostArgs = {
  //     data: request,
  //     headers: {
  //       "Content-Type": "application/json"
  //     }
  //   };
  //   console.log("get-news: tx:", JSON.stringify(request, null, 2));
  //   return new Promise<void>((resolve, reject) => {
  //     this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/get-news"), args, (data: GetNewsResponse, serviceResponse: Response) => {
  //       if (serviceResponse.statusCode === 200) {
  //         console.log("get-news: rx:", JSON.stringify(data, null, 2));
  //         resolve();
  //       } else {
  //         reject(serviceResponse.statusCode);
  //       }
  //     });
  //   });
  // }

  private async getStatus(): Promise<void> {
    const details: UserStatusDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
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

  // private async registerDevice(): Promise<void> {
  //   const details: RegisterDeviceDetails = {
  //     address: this.keyInfo.address,
  //     type: "web",
  //     token: Math.round(Math.random() * 10000000).toFixed(0).toString(),
  //     timestamp: Date.now()
  //   };
  //   const detailsString = JSON.stringify(details);
  //   const request: RestRequest<RegisterDeviceDetails> = {
  //     version: 1,
  //     details: detailsString,
  //     signature: KeyUtils.signString(detailsString, this.keyInfo)
  //   };
  //   const args: PostArgs = {
  //     data: request,
  //     headers: {
  //       "Content-Type": "application/json"
  //     }
  //   };
  //   console.log("register-device: tx:", JSON.stringify(request, null, 2));
  //   return new Promise<void>((resolve, reject) => {
  //     this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/register-device"), args, (data: UserStatusResponse, serviceResponse: Response) => {
  //       if (serviceResponse.statusCode === 200) {
  //         console.log("register-device: rx:", JSON.stringify(data, null, 2));
  //         resolve();
  //       } else {
  //         reject(serviceResponse.statusCode);
  //       }
  //     });
  //   });
  // }

  private async registerIdentity(name: string, handle: string, location: string): Promise<void> {
    const details: UpdateUserIdentityDetails = {
      imageId: null,
      address: this.keyInfo.address,
      fingerprint: null,
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

  private async getFeed(): Promise<void> {
    const details: GetFeedsDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      feeds: [{ type: 'recommended', maxCount: 5 },
      { type: 'top', maxCount: 5 },
      { type: 'new', maxCount: 5 },
      { type: 'mine', maxCount: 5 },
      { type: 'opened', maxCount: 5 }],
      existingPromotedCardIds: []
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<GetFeedsDetails> = {
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
    console.log("get-feed: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/get-feed"), args, (data: GetFeedsResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("get-feed: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private uploadFile(): Promise<void> {
    console.log("uploadFile: tx");
    return new Promise<void>((resolve, reject) => {
      const postRq = rq.post(url.resolve(configuration.get('baseClientUri'), "/d/upload"), (error: any, response: rq.RequestResponse, body: any) => {
        if (error) {
          console.error("uploadFile: rx failed", error);
          reject(error);
        } else {
          console.log("uploadFile: rx", response, body);
          resolve();
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
    });
  }

  private async postCard(): Promise<void> {
    const details: PostCardDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      text: "hello world",
      keywords: ["test"],
      searchText: "hello world",
      private: false,
      pricing: {
        openFeeUnits: 1
      },
      sharedState: {
        properties: { hello: "world" },
        collections: {},
        files: {}
      },
      fileIds: []
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<PostCardDetails> = {
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
    console.log("post-card: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/post-card"), args, (data: PostCardResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("post-card: rx:", JSON.stringify(data, null, 2));
          this.postedCardId = data.cardId;
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async getCard(cardId: string): Promise<void> {
    const details: GetCardDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      cardId: cardId,
      includePromotedCard: false,
      channelIdContext: null
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<GetCardDetails> = {
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
    console.log("get-card: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/get-card"), args, (data: GetCardResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("get-card: rx:", JSON.stringify(data, null, 2));
          this.fetchedCard = data.card;
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async cardImpression(cardId: string): Promise<void> {
    // const details: CardImpressionDetails = {
    //   address: this.keyInfo.address,
    //   timestamp: Date.now(),
    //   cardId: cardId
    // };
    // const detailsString = JSON.stringify(details);
    // const request: RestRequest<CardImpressionDetails> = {
    //   version: 1,
    //   details: detailsString,
    //   signature: KeyUtils.signString(detailsString, this.keyInfo)
    // };
    // const args: PostArgs = {
    //   data: request,
    //   headers: {
    //     "Content-Type": "application/json"
    //   }
    // };
    // console.log("card-impression: tx:", JSON.stringify(request, null, 2));
    // return new Promise<void>((resolve, reject) => {
    //   this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/card-impression"), args, (data: CardImpressionResponse, serviceResponse: Response) => {
    //     if (serviceResponse.statusCode === 200) {
    //       console.log("card-impression: rx:", JSON.stringify(data, null, 2));
    //       resolve();
    //     } else {
    //       reject(serviceResponse.statusCode);
    //     }
    //   });
    // });
  }

  private async cardOpened(cardId: string): Promise<void> {
    const details: CardOpenedDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      cardId: cardId,
      adSlotId: null
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<CardOpenedDetails> = {
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
    console.log("card-opened: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/card-opened"), args, (data: CardOpenedResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("card-opened: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async cardPay(card: CardDescriptor): Promise<void> {
    const transaction: BankTransactionDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      type: "transfer",
      reason: "card-open-fee",
      relatedCardId: card.id,
      relatedCouponId: null,
      amount: card.pricing.openFee,
      toRecipients: [{
        address: card.by.address,
        portion: "remainder",
        reason: "content-purchase"
      }]
    };
    const transactionString = JSON.stringify(transaction);
    const transactionSignature = KeyUtils.signString(transactionString, this.keyInfo);
    const details: CardPayDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      transaction: {
        objectString: transactionString,
        signature: transactionSignature
      }
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<CardPayDetails> = {
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
    console.log("card-pay: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/card-pay"), args, (data: CardPayResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("card-pay: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async cardClosed(cardId: string): Promise<void> {
    const details: CardClosedDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      cardId: cardId
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<CardClosedDetails> = {
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
    console.log("card-closed: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/card-closed"), args, (data: CardClosedResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("card-closed: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

  private async cardLike(cardId: string): Promise<void> {
    const details: UpdateCardLikeDetails = {
      address: this.keyInfo.address,
      fingerprint: null,
      timestamp: Date.now(),
      cardId: cardId,
      selection: "like"
    };
    const detailsString = JSON.stringify(details);
    const request: RestRequest<UpdateCardLikeDetails> = {
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
    console.log("update-card-like: tx:", JSON.stringify(request, null, 2));
    return new Promise<void>((resolve, reject) => {
      this.restClient.post(url.resolve(configuration.get('baseClientUri'), "/d/updated-card-like"), args, (data: UpdateCardLikeResponse, serviceResponse: Response) => {
        if (serviceResponse.statusCode === 200) {
          console.log("update-card-like: rx:", JSON.stringify(data, null, 2));
          resolve();
        } else {
          reject(serviceResponse.statusCode);
        }
      });
    });
  }

}

const testClient = new TestClient();

export { testClient };
