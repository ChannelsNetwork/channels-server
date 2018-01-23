import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo, GetChannelDetails, GetChannelResponse, ChannelDescriptor, GetChannelsDetails, GetChannelsResponse, ChannelFeedType, UpdateChannelDetails, UpdateChannelResponse, UpdateChannelSubscriptionDetails, UpdateChannelSubscriptionResponse, ChannelDescriptorWithCards, CardDescriptor } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { Initializable } from "./interfaces/initializable";
import { SERVER_VERSION } from "./server-version";
import { ChannelRecord, UserRecord, ChannelUserRecord, ChannelSubscriptionState } from "./interfaces/db-records";
import { fileManager } from "./file-manager";
import { userManager } from "./user-manager";
import * as LRU from 'lru-cache';
import { cardManager } from "./card-manager";

export class ChannelManager implements RestServer, Initializable {
  private app: express.Application;
  private urlManager: UrlManager;
  private subscribedChannelIdsByUser = LRU<string, string[]>({ max: 10000, maxAge: 1000 * 60 * 5 });
  private channelIdsByCard = LRU<string, string[]>({ max: 10000, maxAge: 1000 * 60 * 5 });

  async initialize(urlManager: UrlManager): Promise<void> {
    this.urlManager = urlManager;
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.app = app;
    this.registerHandlers();
  }

  async initialize2(): Promise<void> {
    // noop
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('get-channel'), (request: Request, response: Response) => {
      void this.handleGetChannel(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-channels'), (request: Request, response: Response) => {
      void this.handleGetChannels(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-channel'), (request: Request, response: Response) => {
      void this.handleUpdateChannel(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-channel-subscription'), (request: Request, response: Response) => {
      void this.handleUpdateChannelSubscription(request, response);
    });

  }

  private async handleGetChannel(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetChannelDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      console.log("ChannelManager.get-channel:", request.headers, requestBody.detailsObject);
      let record: ChannelRecord;
      if (requestBody.detailsObject.channelId) {
        record = await db.findChannelById(requestBody.detailsObject.channelId);
      } else if (requestBody.detailsObject.ownerId) {
        const records = await db.findChannelsByOwnerId(requestBody.detailsObject.ownerId);
        if (records.length > 0) {
          record = records[0];
        }
      } else if (requestBody.detailsObject.channelHandle) {
        record = await db.findChannelByHandle(requestBody.detailsObject.channelId);
      } else {
        response.status(400).send("Missing parameter");
        return;
      }
      if (!record) {
        response.status(404).send("No such channel");
        return;
      }
      const userChannel = await db.findChannelUser(record.id, user.id);
      const channel: ChannelDescriptor = {
        id: record.id,
        name: record.name,
        handle: record.handle,
        bannerImage: await fileManager.getFileInfo(record.bannerImageFileId),
        owner: await userManager.getUserDescriptor(record.ownerId, false),
        created: record.created,
        about: record.about,
        linkUrl: record.linkUrl,
        socialLinks: record.socialLinks,
        stats: record.stats,
        subscriptionState: userChannel.subscriptionState ? userChannel.subscriptionState : "unsubscribed"
      };
      const registerResponse: GetChannelResponse = {
        serverVersion: SERVER_VERSION,
        channel: channel
      };
      response.json(registerResponse);
    } catch (err) {
      console.error("ChannelManager.handleGetChannel: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetChannels(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetChannelsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      console.log("ChannelManager.get-channels:", request.headers, requestBody.detailsObject);
      const listInfo = await this.getChannels(user, requestBody.detailsObject.type || "recommended", requestBody.detailsObject.maxChannels || 24, requestBody.detailsObject.maxCardsPerChannel || 4, requestBody.detailsObject.nextPageReference, response);
      const registerResponse: GetChannelsResponse = {
        serverVersion: SERVER_VERSION,
        channels: listInfo.channels,
        nextPageReference: listInfo.nextPageReference
      };
      response.json(registerResponse);
    } catch (err) {
      console.error("ChannelManager.handleGetChannel: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getChannels(user: UserRecord, type: ChannelFeedType, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string, response: Response): Promise<ChannelsListInfo> {
    let listResult: ChannelsRecordsInfo;
    switch (type) {
      case "recommended":
        listResult = await this.getRecommendedChannels(user, maxChannels, maxCardsPerChannel, nextPageReference);
        break;
      case "new":
        listResult = await this.getNewChannels(user, maxChannels, maxCardsPerChannel, nextPageReference);
        break;
      case "subscribed":
        listResult = await this.getSubscribedChannels(user, maxChannels, maxCardsPerChannel, nextPageReference);
        break;
      case "blocked":
        listResult = await this.getBlockedChannels(user, maxChannels, nextPageReference);
        break;
      default:
        response.status(400).send("Invalid type " + type);
        return null;
    }
    const result: ChannelsListInfo = {
      channels: [],
      nextPageReference: listResult.nextPageReference
    };
    for (const record of listResult.records) {
      const descriptor = await this.populateRecordDescriptor(user, record);
      if (descriptor) {
        result.channels.push(descriptor);
      }
    }
    return result;
  }

  private async getRecommendedChannels(user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    if (!maxChannels) {
      maxChannels = 50;
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const includedChannelIds: string[] = [];
    const subscribedChannelIds = await this.findSubscribedChannelIdsForUser(user, 100);
    const cursor = db.getCardsByScore(user.id, false, 0);
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      let selectedChannelId: string;
      const channelIds = await this.findChannelIdsByCard(card.id, 25);
      if (channelIds.length > 0) {
        let found = false;
        for (const channelId of channelIds) {
          if (includedChannelIds.indexOf(channelId) >= 0) {
            found = true;
            break;
          }
        }
        if (!found) {
          for (const channelId of channelIds) {
            if (subscribedChannelIds.indexOf(channelId) >= 0) {
              selectedChannelId = channelId;
              break;
            }
          }
          if (!selectedChannelId) {
            selectedChannelId = channelIds[0];
          }
          const selectedChannel = await db.findChannelById(selectedChannelId);
          if (selectedChannel) {
            result.records.push(selectedChannel);
          }
          if (result.records.length >= maxChannels) {
            break;
          }
        }
      }
    }
    return result;
  }

  private async findSubscribedChannelIdsForUser(user: UserRecord, limit: number): Promise<string[]> {
    let result = this.subscribedChannelIdsByUser.get(user.id);
    if (typeof result !== 'undefined') {
      return result;
    }
    result = [];
    const channelUsers = await db.findChannelUserRecords(user.id, "subscribed", limit, 0);
    for (const channelUser of channelUsers) {
      result.push(channelUser.channelId);
    }
    return result;
  }

  private async findChannelIdsByCard(cardId: string, limit: number): Promise<string[]> {
    let result = this.channelIdsByCard.get(cardId);
    if (typeof result !== 'undefined') {
      return result;
    }
    result = [];
    const channelUsers = await db.findChannelCardsByCard(cardId, "active", limit);
    for (const channelUser of channelUsers) {
      result.push(channelUser.channelId);
    }
    return result;
  }

  private async getNewChannels(user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let lastUpdateLessThan: number;
    if (nextPageReference) {
      const afterRecord = await db.findChannelById(nextPageReference);
      if (afterRecord) {
        lastUpdateLessThan = afterRecord.lastContentUpdate;
      }
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const cursor = await db.getChannelsByLastUpdate(lastUpdateLessThan);
    while (await cursor.hasNext()) {
      const channel = await cursor.next();
      if (result.records.length >= maxChannels) {
        result.nextPageReference = result.records[result.records.length - 1].id;
        break;
      }
      const channelUser = await db.findChannelUser(channel.id, user.id);
      const cards = await this.populateChannelCardsSince(user, channel, channelUser ? channelUser.lastVisited : Date.now() - 1000 * 60 * 60 * 24 * 3, maxCardsPerChannel);
      if (cards.length > 0) {  // Don't list a channel if no cards to show
        result.records.push(channel);
      }
    }
    return result;
  }

  private async populateChannelCardsSince(user: UserRecord, channel: ChannelRecord, since: number, maxCards: number): Promise<CardDescriptor[]> {
    const channelCards = await db.findChannelCardsByChannel(channel.id, "active", since, maxCards);
    const result: CardDescriptor[] = [];
    for (const channelCard of channelCards) {
      const descriptor = await cardManager.populateCardState(channelCard.cardId, false, false, user);
      result.push(descriptor);
    }
    return result;
  }
  private async getSubscribedChannels(user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    return await this.getChannelsByState(user, maxChannels, maxCardsPerChannel, "subscribed", nextPageReference);
  }

  private async getBlockedChannels(user: UserRecord, maxChannels: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    return await this.getChannelsByState(user, maxChannels, 0, "blocked", nextPageReference);
  }

  private async getChannelsByState(user: UserRecord, maxChannels: number, maxCardsPerChannel: number, subscriptionState: ChannelSubscriptionState, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let latestLessThan: number;
    if (nextPageReference) {
      const afterRecord = await db.findChannelUser(nextPageReference, user.id);
      if (afterRecord) {
        latestLessThan = afterRecord.channelLastUpdate;
      }
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const cursor = db.getChannelUserRecords(user.id, subscriptionState, latestLessThan);
    while (await cursor.hasNext()) {
      const channelUser = await cursor.next();
      const channel = await db.findChannelById(channelUser.channelId);
      if (channel) {
        result.records.push(channel);
        if (result.records.length >= maxChannels) {
          result.nextPageReference = result.records[result.records.length - 1].id;
          break;
        }
      }
    }
    return result;
  }

  private async populateRecordDescriptor(user: UserRecord, record: ChannelRecord): Promise<ChannelDescriptor> {
    const channelUser = await db.findChannelUser(record.id, user.id);
    const result: ChannelDescriptor = {
      id: record.id,
      name: record.name,
      handle: record.handle,
      bannerImage: await fileManager.getFileInfo(record.bannerImageFileId),
      owner: await userManager.getUserDescriptor(record.ownerId, false),
      created: record.created,
      about: record.about,
      linkUrl: record.linkUrl,
      socialLinks: record.socialLinks,
      stats: record.stats,
      subscriptionState: channelUser ? channelUser.subscriptionState : "unsubscribed"
    };
    return result;
  }

  private async handleUpdateChannel(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateChannelDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId) {
        response.status(400).send("Missing channelId");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.status !== 'active') {
        response.status(404).send("No such channel");
        return;
      }
      if (channel.ownerId !== user.id) {
        response.status(401).send("Only owner is allowed to update channel");
        return;
      }
      await db.updateChannel(channel.id, requestBody.detailsObject.bannerImageFileId, requestBody.detailsObject.about, requestBody.detailsObject.link, requestBody.detailsObject.socialLinks);
      console.log("ChannelManager.update-channel:", request.headers, requestBody.detailsObject);
      const result: UpdateChannelResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      console.error("ChannelManager.handleUpdateChannel: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateChannelSubscription(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateChannelSubscriptionDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId || !requestBody.detailsObject.subscriptionState) {
        response.status(400).send("Missing channel or subscriptionState");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.status !== 'active') {
        response.status(404).send("No such channel");
        return;
      }
      const channelUser = await db.findChannelUser(channel.id, user.id);
      if (channelUser) {
        await db.updateChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.lastContentUpdate, Date.now());
      } else {
        await db.upsertChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.lastContentUpdate, Date.now());
      }
      console.log("ChannelManager.update-channel-subscription:", request.headers, requestBody.detailsObject);
      const result: UpdateChannelSubscriptionResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      console.error("ChannelManager.handleUpdateChannelSubscription: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const channelManager = new ChannelManager();

export { channelManager };

interface ChannelsRecordsInfo {
  records: ChannelRecord[];
  nextPageReference: string;
}

interface ChannelRecordWithCards {
  record: ChannelRecord;
  cards: CardDescriptor[];
}

interface ChannelsListInfo {
  channels: ChannelDescriptor[];
  nextPageReference: string;
}
