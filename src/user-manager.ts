import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import * as url from 'url';
import { configuration } from "./configuration";
import { RestRequest, RegisterUserDetails } from "./interfaces/rest-services";
import { db } from "./db";
import { UserRecord } from "./interfaces/db-records";

const DYNAMIC_BASE = '/d';
const INITIAL_BALANCE = 10;
const INVITER_REWARD = 2;
const INVITEE_REWARD = 2;
const INVITATIONS_ALLOWED = 5;

export class UserManager {
  private app: express.Application;
  private homeUrl: string;
  private restBaseUrl: string;
  private restRelativeBaseUrl: string;

  constructor(app: express.Application, server: net.Server) {
    this.app = app;
    this.homeUrl = configuration.get('baseClientUri');
    this.restBaseUrl = configuration.get('baseClientUri');
    this.restRelativeBaseUrl = DYNAMIC_BASE;
    this.registerHandlers(this.restRelativeBaseUrl);
  }

  private registerHandlers(restRelativeBaseUrl: string): void {
    this.app.post(restRelativeBaseUrl + '/register-user', (request: Request, response: Response) => {
      void this.handleRegisterUser(request, response);
    });
    this.app.post(restRelativeBaseUrl + '/register-ios-device', (request: Request, response: Response) => {
      void this.handleRegisterIosDevice(request, response);
    });
    this.app.post(restRelativeBaseUrl + '/status', (request: Request, response: Response) => {
      void this.handleStatus(request, response);
    });
  }

  private async handleRegisterUser(request: Request, response: Response): Promise<void> {
    const requestBody = request.body as RestRequest<RegisterUserDetails>;
    if (!this.validateRequest(requestBody, response)) {
      return;
    }
    if (!requestBody.details.address || !requestBody.details.publicKey) {
      response.status(400).send("Invalid request-user details");
      return;
    }
    if (this.getAddressFromKey(requestBody.details.publicKey) !== requestBody.details.address) {
      response.status(400).send("This address is inconsistent with the publicKey provided.");
      return;
    }
    let userRecord = await db.findUserByAddress(requestBody.details.address);
    if (!userRecord) {
      const inviter = await db.findUserByInviterCode(requestBody.details.inviteCode);
      let inviteeReward = 0;
      if (inviter && inviter.invitationsRemaining > 0) {
        await db.incrementInvitationsAccepted(inviter, INVITER_REWARD);
        inviteeReward = INVITEE_REWARD;
      }
      const inviteCode = await this.generateInviteCode();
      userRecord = await db.insertUser(requestBody.details.address, requestBody.details.publicKey, requestBody.details.inviteCode, inviteCode, INITIAL_BALANCE + inviteeReward, inviteeReward, 0, INVITATIONS_ALLOWED, 0);
    }
    await this.getUserStatus(userRecord, response);
  }

  private async getUserStatus(user: UserRecord, response: Response): Promise<void> {
    // todo
  }

  private async handleRegisterIosDevice(request: Request, response: Response): Promise<void> {
    // todo
  }

  private async handleStatus(request: Request, response: Response): Promise<void> {
    // todo
  }

  private validateRequest<T>(requestBody: RestRequest<T>, response: Response): boolean {
    return false;
  }
  private getAddressFromKey(publicKey: string): string {
    return null;
  }

  private generateInviteCode(): Promise<string> {
    return null;
  }
}
