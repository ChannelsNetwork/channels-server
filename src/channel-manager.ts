import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo, GetChannelDetails, GetChannelResponse, ChannelDescriptor, GetChannelsDetails, GetChannelsResponse, ChannelFeedType, UpdateChannelDetails, UpdateChannelResponse, UpdateChannelSubscriptionDetails, UpdateChannelSubscriptionResponse, ChannelDescriptorWithCards, CardDescriptor, ReportChannelVisitDetails, ReportChannelVisitResponse, SearchChannelResults } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { Initializable } from "./interfaces/initializable";
import { SERVER_VERSION } from "./server-version";
import { ChannelRecord, UserRecord, ChannelUserRecord, ChannelSubscriptionState, CardRecord, ChannelCardRecord } from "./interfaces/db-records";
import { fileManager } from "./file-manager";
import { userManager } from "./user-manager";
import * as LRU from 'lru-cache';
import { cardManager } from "./card-manager";
import { Cursor } from "mongodb";
import { emailManager, EmailButton } from "./email-manager";
import * as escapeHtml from 'escape-html';
import { Utils } from './utils';
import { NotificationHandler, ChannelsServerNotification, awsManager } from "./aws-manager";
import { errorManager } from "./error-manager";

const MINIMUM_CONTENT_NOTIFICATION_INTERVAL = 1000 * 60 * 60 * 24;
const MAX_KEYWORDS_PER_CHANNEL = 16;

export class ChannelManager implements RestServer, Initializable, NotificationHandler {
  private app: express.Application;
  private urlManager: UrlManager;
  private subscribedChannelIdsByUser = LRU<string, string[]>({ max: 10000, maxAge: 1000 * 60 * 5 });
  private channelIdsByCard = LRU<string, string[]>({ max: 10000, maxAge: 1000 * 60 * 5 });

  async initialize(urlManager: UrlManager): Promise<void> {
    awsManager.registerNotificationHandler(this);
    this.urlManager = urlManager;
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.app = app;
    this.registerHandlers();
  }

  async initialize2(): Promise<void> {
    // Need to create channels for users if they don't already have one
    const cursor = db.getUsersWithIdentity();
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      let channel = await db.findChannelByHandle(user.identity.handle);
      if (!channel) {
        channel = await this.createChannelForUser(user);
        const cardCursor = await db.getCardsByAuthor(user.id);
        while (await cardCursor.hasNext()) {
          const card = await cardCursor.next();
          console.log("Channel.initialize2:     Adding card to channel", channel.handle, card.summary.title);
          await this.addCardToChannel(card, channel);
          await db.incrementChannelStat(channel.id, "revenue", card.stats.revenue.value);
        }
        await cardCursor.close();
      }
    }
    await cursor.close();
    setInterval(this.poll.bind(this), 1000 * 60 * 15);
  }

  private async poll(): Promise<void> {
    const cursor = db.getChannelUserPendingNotifications();
    while (await cursor.hasNext()) {
      const channelUser = await cursor.next();
      if (channelUser.lastCardPosted < channelUser.lastNotification) {
        errorManager.warning("Channel.poll: Unexpected lastCardPosted < lastNotification.  Ignoring.", null);
      } else {
        const user = await userManager.getUser(channelUser.userId, true);
        if (user.identity && user.identity.emailAddress && user.identity.emailConfirmed) {
          if (!user.notifications || (user.notifications && !user.notifications.disallowContentNotifications && (!user.notifications.lastContentNotification || Date.now() - user.notifications.lastContentNotification > MINIMUM_CONTENT_NOTIFICATION_INTERVAL))) {
            await this.sendUserContentNotification(user);
          } else {
            console.log("Channel.poll: skipping content notification because disallowed or too soon", user.identity.handle);
          }
        } else {
          console.log("Channel.poll: skipping content notification because email not confirmed", user.identity.handle);
        }
      }
    }
  }

  async createChannelForUser(user: UserRecord): Promise<ChannelRecord> {
    console.log("Channel.createChannelForUser: Creating channel for user", user.identity.handle);
    const channel = await db.insertChannel(user.identity.handle, user.identity.name, user.identity.location, user.id, null, null, null, null, 0);
    return channel;
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
    this.app.post(this.urlManager.getDynamicUrl('report-channel-visit'), (request: Request, response: Response) => {
      void this.handleReportChannelVisit(request, response);
    });

  }

  async handleNotification(notification: ChannelsServerNotification): Promise<void> {
    switch (notification.type) {
      case 'card-posted':
        await this.handleCardPostedNotification(notification);
        break;
      case 'channel-subscription-changed':
        await this.handleChannelSubscriptionChangedNotification(notification);
        break;
      default:
        break;
    }
  }

  private async handleCardPostedNotification(notification: ChannelsServerNotification): Promise<void> {
    console.log("ChannelManager.handleCardPostedNotification");
    this.channelIdsByCard.del(notification.card);
  }

  private async handleChannelSubscriptionChangedNotification(notification: ChannelsServerNotification): Promise<void> {
    console.log("ChannelManager.handleChannelSubscriptionChangedNotification");
    this.subscribedChannelIdsByUser.del(notification.user);
    this.channelIdsByCard.reset();
  }

  private async announceSubscriptionChange(channel: ChannelRecord, user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'channel-subscription-changed',
      user: user.id,
      channel: channel.id
    };
    await awsManager.sendSns(notification);
  }

  private async handleGetChannel(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetChannelDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      } else if (requestBody.detailsObject.ownerHandle) {
        const owner = await userManager.getUserByHandle(requestBody.detailsObject.ownerHandle);
        if (!owner) {
          response.status(404).send("No such user handle");
          return;
        }
        const records = await db.findChannelsByOwnerId(owner.id);
        if (records.length > 0) {
          record = records[0];
        }
      } else {
        response.status(400).send("Missing parameter");
        return;
      }
      if (!record) {
        response.status(404).send("No such channel");
        return;
      }
      const channel = await this.getChannelDescriptor(user, record);
      const registerResponse: GetChannelResponse = {
        serverVersion: SERVER_VERSION,
        channel: channel
      };
      response.json(registerResponse);
    } catch (err) {
      errorManager.error("ChannelManager.handleGetChannel: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getChannelDescriptor(user: UserRecord, record: ChannelRecord): Promise<ChannelDescriptor> {
    const userChannel = await this.ensureChannelUser(record, user);
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
    return channel;
  }

  private async getChannelDescriptors(user: UserRecord, records: ChannelRecord[]): Promise<ChannelDescriptor[]> {
    const result: ChannelDescriptor[] = [];
    for (const record of records) {
      result.push(await this.getChannelDescriptor(user, record));
    }
    return result;
  }

  private async handleGetChannels(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetChannelsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      console.log("ChannelManager.get-channels:", request.headers, requestBody.detailsObject);
      const listInfo = await this.getChannels(user, requestBody.detailsObject.type || "recommended", requestBody.detailsObject.maxChannels || 24, requestBody.detailsObject.maxCardsPerChannel || 4, requestBody.detailsObject.nextPageReference, request, response);
      const registerResponse: GetChannelsResponse = {
        serverVersion: SERVER_VERSION,
        channels: listInfo.channels,
        nextPageReference: listInfo.nextPageReference
      };
      response.json(registerResponse);
    } catch (err) {
      errorManager.error("ChannelManager.handleGetChannel: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getChannels(user: UserRecord, type: ChannelFeedType, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string, request: Request, response: Response): Promise<ChannelsListInfo> {
    let listResult: ChannelsRecordsInfo;
    switch (type) {
      case "recommended":
        listResult = await this.getRecommendedChannels(request, user, maxChannels, maxCardsPerChannel, nextPageReference);
        break;
      case "new":
        listResult = await this.getNewChannels(request, user, maxChannels, maxCardsPerChannel, nextPageReference);
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

  private async getRecommendedChannels(request: Request, user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    if (!maxChannels) {
      maxChannels = 50;
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const includedChannelIds: string[] = [];
    const subscribedChannelIds = await this.findSubscribedChannelIdsForUser(user, false);
    const cursor = db.getCardsByScore(user.id, false, 0);
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      let selectedChannelId: string;
      const channelIds = await this.findChannelIdsByCard(card.id);
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
    await cursor.close();
    return result;
  }

  getCardsInChannels(channelIds: string[], postedSince: number): Cursor<ChannelCardRecord> {
    return db.getChannelCardsInChannels(channelIds, postedSince);
  }

  async findSubscribedChannelIdsForUser(user: UserRecord, force: boolean): Promise<string[]> {
    let result = this.subscribedChannelIdsByUser.get(user.id);
    if (!force && typeof result !== 'undefined') {
      return result;
    }
    result = [];
    const channelUsers = await db.findChannelUserRecords(user.id, "subscribed", 1000, 0, 0);
    for (const channelUser of channelUsers) {
      result.push(channelUser.channelId);
    }
    return result;
  }

  private async findChannelIdsByCard(cardId: string): Promise<string[]> {
    let result = this.channelIdsByCard.get(cardId);
    if (typeof result !== 'undefined') {
      return result;
    }
    result = [];
    const channelCards = await db.findChannelCardsByCard(cardId, 100);
    for (const channelCard of channelCards) {
      result.push(channelCard.channelId);
    }
    return result;
  }

  private async getNewChannels(request: Request, user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
    let lastUpdateLessThan: number;
    if (nextPageReference) {
      const afterRecord = await db.findChannelById(nextPageReference);
      if (afterRecord) {
        lastUpdateLessThan = afterRecord.latestCardPosted;
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
      const cards = await this.populateChannelCardsSince(request, user, channel, channelUser ? channelUser.lastVisited : Date.now() - 1000 * 60 * 60 * 24 * 3, maxCardsPerChannel);
      if (cards.length > 0) {  // Don't list a channel if no cards to show
        result.records.push(channel);
      }
    }
    await cursor.close();
    return result;
  }

  private async populateChannelCardsSince(request: Request, user: UserRecord, channel: ChannelRecord, since: number, maxCards: number): Promise<CardDescriptor[]> {
    const channelCards = await db.findChannelCardsByChannel(channel.id, since, maxCards);
    const result: CardDescriptor[] = [];
    for (const channelCard of channelCards) {
      const descriptor = await cardManager.populateCardState(request, channelCard.cardId, false, false, user);
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
        latestLessThan = afterRecord.lastCardPosted;
      }
    }
    const result: ChannelsRecordsInfo = {
      records: [],
      nextPageReference: null
    };
    const cursor = db.getChannelUserRecords(user.id, subscriptionState, latestLessThan, 0);
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
    await cursor.close();
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
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId) {
        response.status(400).send("Missing channelId");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.state !== 'active') {
        response.status(404).send("No such channel");
        return;
      }
      if (channel.ownerId !== user.id) {
        response.status(401).send("Only owner is allowed to update channel");
        return;
      }
      await db.updateChannel(channel.id, requestBody.detailsObject.name, requestBody.detailsObject.bannerImageFileId, requestBody.detailsObject.about, requestBody.detailsObject.link, requestBody.detailsObject.socialLinks);
      console.log("ChannelManager.update-channel:", request.headers, requestBody.detailsObject);
      const result: UpdateChannelResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      errorManager.error("ChannelManager.handleUpdateChannel: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateChannelSubscription(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateChannelSubscriptionDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId || !requestBody.detailsObject.subscriptionState) {
        response.status(400).send("Missing channel or subscriptionState");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.state !== 'active') {
        response.status(404).send("No such channel");
        return;
      }
      console.log("ChannelManager.update-channel-subscription:", request.headers, requestBody.detailsObject);
      const channelUser = await db.findChannelUser(channel.id, user.id);
      let subscriptionChange = 0;
      if (requestBody.detailsObject.subscriptionState === "subscribed") {
        subscriptionChange++;
      }
      if (channelUser) {
        if (channelUser.subscriptionState === "subscribed") {
          subscriptionChange--;
        }
        await db.updateChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.latestCardPosted, Date.now());
      } else {
        await db.upsertChannelUser(channel.id, user.id, requestBody.detailsObject.subscriptionState, channel.latestCardPosted, Date.now());
      }
      if (subscriptionChange) {
        await db.incrementChannelStat(channel.id, "subscribers", subscriptionChange);
      }
      await this.announceSubscriptionChange(channel, user);
      const result: UpdateChannelSubscriptionResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      errorManager.error("ChannelManager.handleUpdateChannelSubscription: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleReportChannelVisit(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ReportChannelVisitDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId) {
        response.status(400).send("Missing channel");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.state !== 'active') {
        response.status(404).send("No such channel");
        return;
      }
      console.log("ChannelManager.report-channel-visit:", request.headers, requestBody.detailsObject);
      const channelUser = await this.ensureChannelUser(channel, user);
      await db.updateChannelUserLastVisit(channel.id, user.id, Date.now());
      const result: ReportChannelVisitResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      errorManager.error("ChannelManager.handleReportChannelVisit: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async ensureChannelUser(channel: ChannelRecord, user: UserRecord): Promise<ChannelUserRecord> {
    const channelUser = await db.findChannelUser(channel.id, user.id);
    if (channelUser) {
      return channelUser;
    }
    return await db.upsertChannelUser(channel.id, user.id, "unsubscribed", channel.latestCardPosted, 0);
  }

  async addCardToUserChannel(card: CardRecord, user: UserRecord): Promise<void> {
    const channel = await this.getUserDefaultChannel(user);
    await this.addCardToChannel(card, channel);
  }

  async addCardToChannel(card: CardRecord, channel: ChannelRecord): Promise<void> {
    const channelCard = await db.findChannelCard(channel.id, card.id);
    let incrementChannelCardCount = false;
    if (!channelCard) {
      await db.upsertChannelCard(channel.id, card.id, card.postedAt);
      incrementChannelCardCount = true;
    }
    if (incrementChannelCardCount) {
      await db.incrementChannelStat(channel.id, "cards", 1);
      if (channel.latestCardPosted < card.postedAt) {
        await db.updateChannelLatestCardPosted(channel.id, card.postedAt);
      }
    }
    await db.updateChannelUsersForLatestUpdate(channel.id, card.postedAt);
    await this.updateChannelKeywordsForCard(channel, card.keywords, card.postedAt);
    await this.notifySubscribers(card, channel);
  }

  private async updateChannelKeywordsForCard(channel: ChannelRecord, keywords: string[], cardPostedAt: number): Promise<void> {
    if (!keywords || keywords.length === 0) {
      return;
    }
    for (const keyword of keywords) {
      const channelKeyword = await db.findChannelKeyword(channel.id, keyword);
      if (channelKeyword) {
        await db.updateChannelKeyword(channel.id, keyword, 1, channelKeyword.lastUsed < cardPostedAt ? cardPostedAt : null);
      } else {
        await db.insertChannelKeyword(channel.id, keyword, 1, cardPostedAt);
      }
    }
    const bestKeywords = await db.findChannelKeywords(channel.id, MAX_KEYWORDS_PER_CHANNEL);
    const newKeywords: string[] = [];
    for (const bestKeyword of bestKeywords) {
      newKeywords.push(bestKeyword.keyword);
    }
    await db.updateChannelWithKeywords(channel.id, newKeywords);
  }

  private async notifySubscribers(card: CardRecord, channel: ChannelRecord): Promise<void> {
    console.log("Channel.notifySubscribers", card.id, card.summary.title, channel.handle);
    const cursor = db.getChannelUserSubscribers(channel.id);
    while (await cursor.hasNext()) {
      const channelUser = await cursor.next();
      const user = await userManager.getUser(channelUser.userId, false);
      if (user) {
        if (!user.identity || !user.identity.emailAddress) {
          continue;
        }
        if (!user.identity.emailConfirmed) {
          console.log("Channel.notifySubscribers: Skipping notification because email confirmation still pending", user.identity.emailAddress);
          continue;
        }
        if (user.notifications && (user.notifications.disallowContentNotifications || user.notifications.lastContentNotification > Date.now() - MINIMUM_CONTENT_NOTIFICATION_INTERVAL)) {
          continue;
        }
        void this.sendUserContentNotification(user);
      }
    }
    await cursor.close();
  }

  private async sendUserContentNotification(user: UserRecord): Promise<void> {
    console.log("Channel.sendUserContentNotification", user.id, user.identity.handle);
    const channelIds = await this.findSubscribedChannelIdsForUser(user, false);
    const since = Math.min(Date.now() - 1000 * 60 * 60 * 24 * 7, user.notifications && user.notifications.lastContentNotification ? user.notifications.lastContentNotification : 0);
    const cursor = await db.getChannelCardsInChannels(channelIds, since);
    const cards: CardDescriptor[] = [];
    const sentChannelIds: string[] = [];
    while (await cursor.hasNext()) {
      const channelCard = await cursor.next();
      const card = await db.findCardById(channelCard.cardId, false);
      if (card) {
        const cardUser = await db.findUserCardInfo(user.id, card.id);
        if (!cardUser || cardUser.lastOpened === 0) {
          const descriptor = await cardManager.populateCardState(null, card.id, false, false, user);
          cards.push(descriptor);
          if (sentChannelIds.indexOf(channelCard.channelId) < 0) {
            sentChannelIds.push(channelCard.channelId);
          }
        }
      }
      if (cards.length >= 10) {
        break;
      }
    }
    await cursor.close();
    if (cards.length === 0) {
      console.log("Channel.sendUserContentNotification: no unopened cards; skipping notification", user.id, user.identity.handle);
      return;
    }
    await db.updateUserContentNotification(user);
    await db.updateChannelUserNotificationSent(user.id, sentChannelIds);
    const button: EmailButton = {
      caption: "View feed",
      url: this.urlManager.getAbsoluteUrl("/")
    };
    const cardTable = await this.generateContentEmail(user, cards);
    const info: any = {
      cardTable: cardTable
    };
    const buttons: EmailButton[] = [button];
    await emailManager.sendUsingTemplate("Channels.cc", "no-reply@channels.cc", user.identity.name, user.identity.emailAddress, cards[0].by.name + ": " + cards[0].summary.title, "content-notification", info, buttons);
    console.log("Channel.sendUserContentNotification: notification sent for " + cards.length + " cards", user.id, user.identity.handle);
  }

  private async generateContentEmail(user: UserRecord, cards: CardDescriptor[]): Promise<string> {
    let result = "";
    result += '<div style="width:300px;margin:0 auto;">\n';
    result += '<div style="font-size:24px;font-family:sans-serif;margin:0 0 16px;color:black;">Subscriptions</div>\n';
    for (const card of cards) {
      const channel = await this.findChannelForCard(user, card);
      result += await this.generateCardContent(user, card, channel);
    }
    result += '</div>\n';
    return result;
  }

  private async findChannelForCard(user: UserRecord, card: CardDescriptor): Promise<ChannelDescriptor> {
    const channelIds = await this.findChannelIdsByCard(card.id);
    if (channelIds.length === 0) {
      return null;
    }
    const channel = await db.findChannelById(channelIds[0]);
    if (!channel) {
      return null;
    }
    return await this.getChannelDescriptor(user, channel);
  }

  private getChannelUrl(channel: ChannelDescriptor): string {
    return this.urlManager.getAbsoluteUrl('/channel/' + channel.handle);
  }

  private async generateCardContent(user: UserRecord, card: CardDescriptor, channel: ChannelDescriptor): Promise<string> {
    let result = "";
    result += '<div style="margin:15px 0 50px 0;">\n';
    const url = channel ? this.getChannelUrl(channel) : cardManager.getCardUrl(card);
    result += '<a href="' + url + '" style="border:0;text-decoration:none;">\n';
    if (card.summary.imageId) {
      const coverUrl = fileManager.getCoverImageUrl(card.summary.imageId, 300, 250);
      result += '<img src="' + coverUrl + '" style="width:300px;height:auto;">\n';
    }
    result += '<table width="300" style="font-size:15px;color:black;">\n';
    result += '<tr>\n';
    if (card.by.image) {
      result += '<td style="border:0;padding:0;width:48px;">\n';
      const userUrl = fileManager.getCircularImageUrl(card.by.image.id, 42);
      result += '<img src="' + userUrl + '" style="width:40px;height:auto;">\n';
      result += '</td>\n';
    }
    result += '<td style="border:0;padding:0 5px;">\n';
    result += '<div style="width:250px;whitespace:no-wrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1;">' + escapeHtml(Utils.truncate(card.summary.title, 38, true)) + '</div>\n';
    result += '<div style="color:#555;font-size:85%;">' + escapeHtml(card.by.name) + '</div>\n';
    result += '</td>\n';
    result += '</tr>\n';
    result += '</table>\n';
    result += '</a>\n';
    result += '</div>\n';
    return result;
  }

  async getUserDefaultChannel(user: UserRecord): Promise<ChannelRecord> {
    const channels = await db.findChannelsByOwnerId(user.id);
    const channel = channels.length === 0 ? await this.createChannelForUser(user) : channels[0];
    return channel;
  }

  async onChannelCardTransaction(transaction: BankTransactionDetails): Promise<void> {
    if (transaction.reason !== "card-open-fee") {
      return;
    }
    if (!transaction.relatedCardId) {
      return;
    }
    const channelCards = await db.findChannelCardsByCard(transaction.relatedCardId, 1);
    if (channelCards.length > 0) {
      await db.incrementChannelStat(channelCards[0].channelId, "revenue", transaction.amount);
    }
  }

  async onCardDeleted(card: CardRecord): Promise<void> {
    const cursor = db.getChannelCardsByCard(card.id);
    while (await cursor.hasNext()) {
      const channelCard = await cursor.next();
      await db.incrementChannelStat(channelCard.channelId, "cards", -1);
    }
    await cursor.close();
    await db.removeChannelCardsByCard(card.id);
  }

  async searchChannels(user: UserRecord, searchString: string, skip: number, limit: number): Promise<SearchChannelResults> {
    const result: SearchChannelResults = {
      channels: [],
      moreAvailable: false,
      nextSkip: 0
    };
    if (limit === 0) {
      limit = 12;
    }
    if (limit < 1 || limit > 999) {
      limit = 50;
    }
    const culledRecords: ChannelRecord[] = [];
    const channels = await db.findChannelsBySearch(searchString, skip, limit + 1);
    if (channels.length > 0) {
      const max = (channels[0] as any).searchScore as number;
      for (const channel of channels) {
        console.log("search result: ", (channel as any).searchScore, channel.handle, channel.name);
        const score = (channel as any).searchScore as number;
        if (score > max / 2) {
          culledRecords.push(channel);
        } else {
          break;
        }
      }
    }
    if (channels.length > limit && culledRecords.length === channels.length) {
      result.moreAvailable = true;
      result.nextSkip = skip + limit;
    }
    result.channels = await this.getChannelDescriptors(user, culledRecords);
    return result;
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
