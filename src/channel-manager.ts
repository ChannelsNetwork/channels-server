import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo, GetChannelDetails, GetChannelResponse, ChannelDescriptor } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { Initializable } from "./interfaces/initializable";
import { SERVER_VERSION } from "./server-version";
import { ChannelRecord } from "./interfaces/db-records";
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
        location: record.location,
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
}

const channelManager = new ChannelManager();

export { channelManager };
