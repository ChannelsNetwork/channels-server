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

const MINIMUM_CONTENT_NOTIFICATION_INTERVAL = 1000 * 60 * 60 * 24;

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
    while (cursor.hasNext()) {
      const channelUser = await cursor.next();
      if (channelUser.lastCardPosted < channelUser.lastNotification) {
        console.warn("Channel.poll: Unexpected lastCardPosted < lastNotification.  Ignoring.");
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
      } else if (requestBody.detailsObject.ownerHandle) {
        const owner = userManager.getUserByHandle(requestBody.detailsObject.ownerHandle);
        if (!owner) {
          response.status(404).send("No such user handle");
          return;
        }
        const records = await db.findChannelsByOwnerId(requestBody.detailsObject.ownerId);
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
      console.error("ChannelManager.handleGetChannel: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getChannelDescriptor(user: UserRecord, record: ChannelRecord): Promise<ChannelDescriptor> {
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
    const subscribedChannelIds = await this.findSubscribedChannelIdsForUser(user, false);
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

  private async findChannelIdsByCard(cardId: string, limit: number): Promise<string[]> {
    let result = this.channelIdsByCard.get(cardId);
    if (typeof result !== 'undefined') {
      return result;
    }
    result = [];
    const channelCards = await db.findChannelCardsByCard(cardId, limit);
    for (const channelCard of channelCards) {
      result.push(channelCard.channelId);
    }
    return result;
  }

  private async getNewChannels(user: UserRecord, maxChannels: number, maxCardsPerChannel: number, nextPageReference: string): Promise<ChannelsRecordsInfo> {
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
      const cards = await this.populateChannelCardsSince(user, channel, channelUser ? channelUser.lastVisited : Date.now() - 1000 * 60 * 60 * 24 * 3, maxCardsPerChannel);
      if (cards.length > 0) {  // Don't list a channel if no cards to show
        result.records.push(channel);
      }
    }
    await cursor.close();
    return result;
  }

  private async populateChannelCardsSince(user: UserRecord, channel: ChannelRecord, since: number, maxCards: number): Promise<CardDescriptor[]> {
    const channelCards = await db.findChannelCardsByChannel(channel.id, since, maxCards);
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
      await db.updateChannel(channel.id, requestBody.detailsObject.name, requestBody.detailsObject.bannerImageFileId, requestBody.detailsObject.about, requestBody.detailsObject.link, requestBody.detailsObject.socialLinks);
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
      const result: UpdateChannelSubscriptionResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(result);
    } catch (err) {
      console.error("ChannelManager.handleUpdateChannelSubscription: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleReportChannelVisit(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ReportChannelVisitDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!requestBody.detailsObject.channelId) {
        response.status(400).send("Missing channel");
        return;
      }
      const channel = await db.findChannelById(requestBody.detailsObject.channelId);
      if (!channel || channel.status !== 'active') {
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
      console.error("ChannelManager.handleReportChannelVisit: Failure", err);
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
    await this.notifySubscribers(card, channel);
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
        const descriptor = await cardManager.populateCardState(card.id, false, false, user);
        cards.push(descriptor);
        if (sentChannelIds.indexOf(channelCard.channelId) < 0) {
          sentChannelIds.push(channelCard.channelId);
        }
      }
      if (cards.length > 10) {
        break;
      }
    }
    await cursor.close();
    if (cards.length === 0) {
      return;
    }
    await db.updateUserContentNotification(user);
    await db.updateChannelUserNotificationSent(user.id, sentChannelIds);
    const button: EmailButton = {
      caption: "View feed",
      url: this.urlManager.getAbsoluteUrl("/")
    };
    const info: any = {
      count: cards.length
      // TODO: information about new cards/channels
    };
    const buttons: EmailButton[] = [button];
    const templateName = cards.length > 1 ? "multi-card-notification" : "single-card-notification";
    await emailManager.sendUsingTemplate("Channels.cc", "no-reply@channels.cc", user.identity.name, user.identity.emailAddress, "New cards for you to look at", templateName, info, buttons);
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
      return result;
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
