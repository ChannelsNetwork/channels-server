import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, RegisterDeviceDetails, RegisterDeviceResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo } from "./interfaces/rest-services";
import { db } from "./db";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { Initializable } from "./interfaces/initializable";

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

  }

  private registerHandlers(): void {
    // noop
  }

  // private async handleRegisterUser(request: Request, response: Response): Promise<void> {
  //   try {
  //     const requestBody = request.body as RestRequest<RegisterUserDetails>;
  //     requestBody.detailsObject = JSON.parse(requestBody.details);
  //     if (!RestHelper.validateRequest(requestBody, requestBody.detailsObject ? requestBody.detailsObject.publicKey : null, response)) {
  //       return;
  //     }
  //     if (!requestBody.detailsObject.address || !requestBody.detailsObject.publicKey) {
  //       response.status(400).send("Invalid request-user details");
  //       return;
  //     }
  //     console.log("ChannelManager.register-user:", request.headers, ipAddress);
  //     const registerResponse: RegisterUserResponse = {
  //       serverVersion: SERVER_VERSION,
  //       status: userStatus,
  //       interestRatePerMillisecond: INTEREST_RATE_PER_MILLISECOND,
  //       subsidyRate: await priceRegulator.getUserSubsidyRate(),
  //       operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
  //       operatorAddress: networkEntity.getOperatorAddress(),
  //       networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
  //       networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
  //       referralFraction: networkEntity.getReferralFraction(),
  //       withdrawalsEnabled: bank.withdrawalsEnabled,
  //       depositUrl: configuration.get('braintree.enabled', false) ? this.urlManager.getPublicUrl('deposit') : null,
  //       admin: userRecord.admin
  //     };
  //     response.json(registerResponse);
  //   } catch (err) {
  //     console.error("ChannelManager.handleRegisterUser: Failure", err);
  //     response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
  //   }
  // }
}

const channelManager = new ChannelManager();

export { channelManager };
