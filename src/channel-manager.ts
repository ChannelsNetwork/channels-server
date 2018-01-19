import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo, GetChannelDetails, GetChannelResponse, ChannelDescriptor, GetChannelsDetails, GetChannelsResponse, ChannelFeedType, UpdateChannelDetails, UpdateChannelResponse, UpdateChannelSubscriptionDetails, UpdateChannelSubscriptionResponse } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { Initializable } from "./interfaces/initializable";
import { SERVER_VERSION } from "./server-version";
import { ChannelRecord, UserRecord, ChannelUserRecord, ChannelSubscriptionState } from "./interfaces/db-records";
import { fileManager } from "./file-manager";
import { userManager } from "./user-manager";

export class ChannelManager implements RestServer, Initializable {
  private app: express.Application;
  private urlManager: UrlManager;

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
      const listInfo = await this.getChannels(user, requestBody.detailsObject.type || "recommended", requestBody.detailsObject.maxCount || 24, requestBody.detailsObject.nextPageReference, response);
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

  private async getChannels(user: UserRecord, type: ChannelFeedType, maxCount: number, nextPageReference: string, response: Response): Promise<ChannelsListInfo> {
    let listResult: ChannelsRecordsInfo;
    switch (type) {
      case "recommended":
        listResult = await this.getRecommendedChannels(user, maxCount, nextPageReference);
        break;
      case "new":
        listResult = await this.getNewChannels(user, maxCount, nextPageReference);
        break;
      case "feed":
        listResult = await this.getSubscribedChannels(user, maxCount, nextPageReference);
        break;
      case "blocked":
        listResult = await this.getBlockedChannels(user, maxCount, nextPageReference);
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

  private async getRecommendedChannels(user: UserRecord, maxCount: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let scoreLessThan: number;
    let priorChannelIds: string[] = [];
    if (nextPageReference) {
      const parts = nextPageReference.split(':');
      const cardId = parts[0];
      if (parts.length > 1) {
        priorChannelIds = parts[1].split(',');
      }
      const card = await db.findCardById(cardId, true);
      if (card) {
        scoreLessThan = card.score;
      }
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const subscribedChannelIds = await this.findSubscribedChannelIdsForUser(user, 100);
    const cursor = db.getCardsByScore(user.id, false, scoreLessThan);
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      let selectedChannel: ChannelRecord;
      const channels = await this.findChannelsByCard(card.id, 25);
      if (channels.length > 0) {
        let skip = false;
        for (const channel of channels) {
          if (priorChannelIds.indexOf(channel.id) >= 0) {
            skip = true;
            break;
          }
        }
        if (!skip) {
          for (const channel of channels) {
            if (subscribedChannelIds.indexOf(channel.id) >= 0) {
              selectedChannel = channel;
              break;
            }
          }
          if (!selectedChannel) {
            selectedChannel = channels[0];
          }
          result.records.push(selectedChannel);
          priorChannelIds.push(selectedChannel.id);
          if (result.records.length >= maxCount) {
            result.nextPageReference = card.id + ":" + priorChannelIds.join(',');
            break;
          }
        }
      }
    }
    return result;
  }

  private async findSubscribedChannelIdsForUser(user: UserRecord, limit: number): Promise<string[]> {

  }

  private async findChannelsByCard(cardId: string, limit: number): Promise<ChannelRecord[]> {

  }

  private async getNewChannels(user: UserRecord, maxCount: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let lastUpdateLessThan: number;
    if (nextPageReference) {
      const afterRecord = await db.findChannelById(nextPageReference);
      if (afterRecord) {
        lastUpdateLessThan = afterRecord.lastContentUpdate;
      }
    }
    const channels = await db.findChannelsByLastUpdate(maxCount + 1, lastUpdateLessThan);
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    for (const channel of channels) {
      if (result.records.length >= maxCount) {
        result.nextPageReference = result.records[result.records.length - 1].id;
        break;
      }
      result.records.push(channel);
    }
    return result;
  }

  private async getSubscribedChannels(user: UserRecord, maxCount: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    return await this.getChannelsByState(user, maxCount, "subscribed", nextPageReference);
  }

  private async getBlockedChannels(user: UserRecord, maxCount: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    return await this.getChannelsByState(user, maxCount, "blocked", nextPageReference);
  }

  private async getChannelsByState(user: UserRecord, maxCount: number, subscriptionState: ChannelSubscriptionState, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let latestLessThan: number;
    if (nextPageReference) {
      const afterRecord = await db.findChannelUser(nextPageReference, user.id);
      if (afterRecord) {
        latestLessThan = afterRecord.channelLastUpdate;
      }
    }
    const channelUserRecords = await db.findChannelUserRecords(user.id, subscriptionState, maxCount + 1, latestLessThan);
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    for (const channelUser of channelUserRecords) {
      if (result.records.length >= maxCount) {
        result.nextPageReference = result.records[result.records.length - 1].id;
        break;
      }
      const channel = await db.findChannelById(channelUser.channelId);
      if (channel) {
        result.records.push(channel);
      }
    }
    return result;
  }

  private async populateRecordDescriptor(user: UserRecord, record: ChannelRecord): Promise<ChannelDescriptor> {

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
        await db.updateChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.lastContentUpdate);
      } else {
        await db.upsertChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.lastContentUpdate);
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

interface ChannelsListInfo {
  channels: ChannelDescriptor[];
  nextPageReference: string;
}
