import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, RegisterIosDeviceDetails, UserStatusDetails, Signable, RegisterIosDeviceResponse, UserStatusResponse } from "./interfaces/rest-services";
import { db } from "./db";
import { UserRecord } from "./interfaces/db-records";
import * as NodeRSA from "node-rsa";
import { UrlManager } from "./url-manager";
import { KeyUtils } from "./key-utils";

const INITIAL_BALANCE = 10;
const INVITER_REWARD = 2;
const INVITEE_REWARD = 2;
const INVITATIONS_ALLOWED = 5;
const LETTERS = 'abcdefghjklmnpqrstuvwxyz';
const DIGITS = '0123456789';
const MAX_CLOCK_SKEW = 1000 * 60 * 15;
const NETWORK_BALANCE_RANDOM_PRODUCT = 1.5;

export class UserManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private goLiveDate: number;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
    this.goLiveDate = new Date(2017, 9, 25, 12, 0, 0, 0).getTime();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('register-user'), (request: Request, response: Response) => {
      void this.handleRegisterUser(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('register-ios-device'), (request: Request, response: Response) => {
      void this.handleRegisterIosDevice(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('status'), (request: Request, response: Response) => {
      void this.handleStatus(request, response);
    });
  }

  private async handleRegisterUser(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<RegisterUserDetails>;
    if (!this.validateRequest(requestBody, requestBody.details ? requestBody.details.publicKey : null, response)) {
      return;
    }
    if (!requestBody.details.address || !requestBody.details.publicKey) {
      response.status(400).send("Invalid request-user details");
      return;
    }
    if (KeyUtils.getAddressFromPublicKey(requestBody.details.publicKey) !== requestBody.details.address) {
      response.status(400).send("This address is inconsistent with the publicKey provided.");
      return;
    }
    let userRecord = await db.findUserByAddress(requestBody.details.address);
    if (!userRecord) {
      let networkBalanceIncrease = 0;
      const inviter = await db.findUserByInviterCode(requestBody.details.inviteCode);
      let inviteeReward = 0;
      if (inviter && inviter.invitationsRemaining > 0) {
        const inviterReward = INVITER_REWARD;
        await db.incrementInvitationsAccepted(inviter, inviterReward);
        inviteeReward = INVITEE_REWARD;
        networkBalanceIncrease += inviterReward;
      }
      const inviteCode = await this.generateInviteCode();
      const newBalance = INITIAL_BALANCE + inviteeReward;
      userRecord = await db.insertUser(requestBody.details.address, requestBody.details.publicKey, requestBody.details.inviteCode, inviteCode, newBalance, inviteeReward, 0, INVITATIONS_ALLOWED, 0);
      networkBalanceIncrease += newBalance * (1 + (Math.random() * NETWORK_BALANCE_RANDOM_PRODUCT));
      await db.incrementNetworkBalance(networkBalanceIncrease);
    }
    await this.returnUserStatus(userRecord, response);
  }

  private async handleRegisterIosDevice(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<RegisterIosDeviceDetails>;
    const user = await this.validateRegisteredRequest(requestBody, response);
    if (!user) {
      return;
    }
    if (!requestBody.details.deviceToken) {
      response.status(400).send("Device token is missing or invalid");
      return;
    }
    const existing = await db.findUserByIosToken(requestBody.details.deviceToken);
    if (existing) {
      if (existing.address !== user.address) {
        response.status(409).send("This device token is already associated with a different user");
        return;
      }
    } else {
      await db.appendUserIosToken(user, requestBody.details.deviceToken);
    }
    const reply: RegisterIosDeviceResponse = { success: true };
    response.json(reply);
  }

  private async handleStatus(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<UserStatusDetails>;
    const user = await this.validateRegisteredRequest(requestBody, response);
    if (!user) {
      return;
    }
    await this.returnUserStatus(user, response);
  }

  private validateBasicRequest<T extends Signable>(requestBody: RestRequest<T>, response: Response): boolean {
    if (!requestBody || !requestBody.version || requestBody.version !== 1 || !requestBody.details || !requestBody.signature) {
      response.status(400).send("Invalid request body or unsupported version");
      return false;
    }
    return true;
  }

  private validateRequest<T extends Signable>(requestBody: RestRequest<T>, publicKey: string, response: Response): boolean {
    if (!this.validateBasicRequest(requestBody, response)) {
      return false;
    }
    try {
      if (!KeyUtils.verify(requestBody.details, publicKey, requestBody.signature)) {
        response.status(403).send("Signature is invalid");
        return;
      }
      if (!requestBody.details.timestamp || Math.abs(Date.now() - requestBody.details.timestamp) > MAX_CLOCK_SKEW) {
        response.status(400).send("Timestamp is not current");
        return;
      }
    } catch (err) {
      response.status(401).send("Public key is not valid");
      return;
    }
    return true;
  }

  private async validateRegisteredRequest<T extends Signable>(requestBody: RestRequest<T>, response: Response): Promise<UserRecord> {
    if (!this.validateBasicRequest(requestBody, response)) {
      return null;
    }
    const userRecord = await db.findUserByAddress(requestBody.details.address);
    if (!userRecord) {
      response.status(401).send("No such registered users");
      return null;
    }
    if (!this.validateRequest(requestBody, userRecord.publicKey, response)) {
      return null;
    }
    await db.updateLastUserContact(userRecord, Date.now());
    return userRecord;
  }

  private async returnUserStatus(user: UserRecord, response: Response): Promise<void> {
    const network = await db.getNetwork();
    const result: UserStatusResponse = {
      success: true,
      status: {
        goLive: this.goLiveDate,
        userBalance: user.balance,
        networkBalance: Math.floor(network.balance),
        inviteCode: user.inviterCode.toUpperCase(),
        invitationsUsed: user.invitationsAccepted,
        invitationsRemaining: user.invitationsRemaining,
        inviterRewards: user.inviterRewards,
        inviteeReward: user.inviteeReward
      }
    };
    response.json(result);
  }

  private async generateInviteCode(): Promise<string> {
    while (true) {
      let result = '';
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      const existing = await db.findUserByInviterCode(result);
      if (!existing) {
        return result;
      }
    }
  }
}

const userManager = new UserManager();

export { userManager };
