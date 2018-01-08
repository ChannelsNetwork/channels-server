import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, RegisterDeviceDetails, RegisterDeviceResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo } from "./interfaces/rest-services";
import { db } from "./db";
import { UserRecord, IpAddressRecord, IpAddressStatus } from "./interfaces/db-records";
import * as NodeRSA from "node-rsa";
import { UrlManager } from "./url-manager";
import { KeyUtils, KeyInfo } from "./key-utils";
import { RestHelper } from "./rest-helper";
import * as url from 'url';
import { socketServer, UserSocketHandler } from "./socket-server";
import { priceRegulator } from "./price-regulator";
import { networkEntity } from "./network-entity";
import { Initializable } from "./interfaces/initializable";
import { bank } from "./bank";
import { emailManager } from "./email-manager";
import { SERVER_VERSION } from "./server-version";
import * as uuid from "uuid";
import { Utils } from "./utils";
import fetch from "node-fetch";
import { fileManager } from "./file-manager";

const INVITER_REWARD = 1;
const INVITEE_REWARD = 1;
const INVITATIONS_ALLOWED = 5;
const LETTERS = 'abcdefghjklmnpqrstuvwxyz';
const NON_ZERO_DIGITS = '123456789';
const DIGITS = '0123456789';
const ANNUAL_INTEREST_RATE = 0.03;
const INTEREST_RATE_PER_MILLISECOND = Math.pow(1 + ANNUAL_INTEREST_RATE, 1 / (365 * 24 * 60 * 60 * 1000)) - 1;
const MIN_INTEREST_INTERVAL = 1000 * 60 * 15;
const BALANCE_UPDATE_INTERVAL = 1000 * 60 * 60 * 3;
const RECOVERY_CODE_LIFETIME = 1000 * 60 * 10;
const MAX_USER_IP_ADDRESSES = 64;
const INITIAL_BALANCE = 5;
const DEFAULT_TARGET_BALANCE = 5;

const MAX_IP_ADDRESS_LIFETIME = 1000 * 60 * 60 * 24 * 30;
const IP_ADDRESS_FAIL_RETRY_INTERVAL = 1000 * 60 * 60 * 24;

export class UserManager implements RestServer, UserSocketHandler, Initializable {
  private app: express.Application;
  private urlManager: UrlManager;
  private goLiveDate: number;

  async initialize(urlManager: UrlManager): Promise<void> {
    this.urlManager = urlManager;
    socketServer.setUserHandler(this);
    this.goLiveDate = new Date(2017, 11, 15, 12, 0, 0, 0).getTime();
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.app = app;
    this.registerHandlers();
  }

  async initialize2(): Promise<void> {
    // const oldUsers = await db.getOldUsers();
    // for (const oldUser of oldUsers) {
    //   const existing = await db.findUserById(oldUser.id);
    //   if (!existing && oldUser.keys.length > 0 && oldUser.keys[0].address && oldUser.keys[0].publicKey && oldUser.id && oldUser.identity && oldUser.identity.handle) {
    //     const user = await db.insertUser("normal", oldUser.keys[0].address, oldUser.keys[0].publicKey, null, null, uuid.v4(), 0, 0, DEFAULT_TARGET_BALANCE, DEFAULT_TARGET_BALANCE, null, oldUser.id, oldUser.identity);
    //     await db.incrementUserBalance(user, oldUser.balance, false, Date.now());
    //     console.log("UserManager.initialize2: Migrated old user " + oldUser.id + " to new structure with balance = " + oldUser.balance);
    //   }
    // }
    const users = await db.findUsersWithoutCountry();
    for (const user of users) {
      if (user.ipAddresses.length > 0) {
        const result = await this.fetchIpAddressInfo(user.ipAddresses[user.ipAddresses.length - 1]);
        if (result) {
          await db.updateUserGeo(user.id, result.countryCode, result.region, result.city, result.zip);
        } else {
          await db.updateUserGeo(user.id, null, null, null, null);
        }
      } else {
        await db.updateUserGeo(user.id, null, null, null, null);
      }
    }
    setInterval(() => {
      void this.updateBalances();
    }, 30000);
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('register-user'), (request: Request, response: Response) => {
      void this.handleRegisterUser(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('register-device'), (request: Request, response: Response) => {
      void this.handleRegisterDevice(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('sign-in'), (request: Request, response: Response) => {
      void this.handleSignIn(request, response);
    });
    // this.app.post(this.urlManager.getDynamicUrl('register-device'), (request: Request, response: Response) => {
    //   void this.handleRegisterDevice(request, response);
    // });
    this.app.post(this.urlManager.getDynamicUrl('account-status'), (request: Request, response: Response) => {
      void this.handleStatus(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-identity'), (request: Request, response: Response) => {
      void this.handleUpdateIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('request-recovery-code'), (request: Request, response: Response) => {
      void this.handleRequestRecoveryCode(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('recover-user'), (request: Request, response: Response) => {
      void this.handleRecoverUser(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-identity'), (request: Request, response: Response) => {
      void this.handleGetIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('check-handle'), (request: Request, response: Response) => {
      void this.handleCheckHandle(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-handle'), (request: Request, response: Response) => {
      void this.handleGetHandle(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-users'), (request: Request, response: Response) => {
      void this.handleAdminGetUsers(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-set-user-mailing-list'), (request: Request, response: Response) => {
      void this.handleAdminSetUserMailingList(request, response);
    });
  }

  private async handleRegisterUser(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RegisterUserDetails>;
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!RestHelper.validateRequest(requestBody, requestBody.detailsObject ? requestBody.detailsObject.publicKey : null, response)) {
        return;
      }
      if (!requestBody.detailsObject.address || !requestBody.detailsObject.publicKey) {
        response.status(400).send("Invalid request-user details");
        return;
      }
      if (KeyUtils.getAddressFromPublicKey(requestBody.detailsObject.publicKey) !== requestBody.detailsObject.address) {
        response.status(400).send("This address is inconsistent with the publicKey provided.");
        return;
      }
      console.log("UserManager.register-user", requestBody.detailsObject.address);
      const ipAddressHeader = request.headers['x-forwarded-for'] as string;
      let ipAddress: string;
      if (ipAddressHeader) {
        const ipAddresses = ipAddressHeader.split(',');
        if (ipAddresses.length >= 1 && ipAddresses[0].trim().length > 0) {
          ipAddress = ipAddresses[0].trim();
        }
      } else if (request.ip) {
        ipAddress = request.ip.trim();
      }
      let ipAddressInfo: IpAddressRecord;
      if (ipAddress && ipAddress.length > 0) {
        ipAddressInfo = await this.fetchIpAddressInfo(ipAddress);
      }
      console.log("UserManager.register-user:", request.headers, ipAddress);
      let userRecord = await db.findUserByAddress(requestBody.detailsObject.address);
      if (userRecord) {
        if (ipAddress && userRecord.ipAddresses.indexOf(ipAddress) < 0) {
          await db.addUserIpAddress(userRecord, ipAddress, ipAddressInfo ? ipAddressInfo.country : null, ipAddressInfo ? ipAddressInfo.region : null, ipAddressInfo ? ipAddressInfo.city : null, ipAddressInfo ? ipAddressInfo.zip : null);
          if (userRecord.ipAddresses.length > MAX_USER_IP_ADDRESSES) {
            await db.discardUserIpAddress(userRecord, userRecord.ipAddresses[0]);
          }
        } else if (ipAddressInfo && ipAddressInfo.city && ipAddressInfo.city !== userRecord.city) {
          await db.updateUserGeo(userRecord.id, ipAddressInfo.country, ipAddressInfo.region, ipAddressInfo.city, ipAddressInfo.zip);
        }
      } else {
        const historicalUser = await db.findUserByHistoricalAddress(requestBody.detailsObject.address);
        if (historicalUser) {
          response.status(409).send("This address was registered previously and cannot be reused.");
          return;
        }
        const inviter = await db.findUserByInviterCode(requestBody.detailsObject.inviteCode);
        let inviteeReward = 0;
        if (inviter && inviter.invitationsRemaining > 0) {
          await db.incrementInvitationsAccepted(inviter, INVITER_REWARD);
          const rewardRecipient: BankTransactionRecipientDirective = {
            address: inviter.address,
            portion: "remainder",
            reason: "invitation-reward-recipient"
          };
          const reward: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "inviter-reward",
            amount: INVITER_REWARD,
            relatedCardId: null,
            relatedCouponId: null,
            toRecipients: [rewardRecipient]
          };
          await networkEntity.performBankTransaction(reward, null, true, false);
          inviteeReward = INVITEE_REWARD;
        }
        const inviteCode = await this.generateInviteCode();
        userRecord = await db.insertUser("normal", requestBody.detailsObject.address, requestBody.detailsObject.publicKey, null, requestBody.detailsObject.inviteCode, inviteCode, INVITATIONS_ALLOWED, 0, DEFAULT_TARGET_BALANCE, DEFAULT_TARGET_BALANCE, ipAddress, ipAddressInfo ? ipAddressInfo.country : null, ipAddressInfo ? ipAddressInfo.region : null, ipAddressInfo ? ipAddressInfo.city : null, ipAddressInfo ? ipAddressInfo.zip : null, requestBody.detailsObject.referrer, requestBody.detailsObject.landingUrl);
        const grantRecipient: BankTransactionRecipientDirective = {
          address: requestBody.detailsObject.address,
          portion: "remainder",
          reason: "invitation-reward-recipient"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "grant",
          amount: INITIAL_BALANCE,
          relatedCardId: null,
          relatedCouponId: null,
          toRecipients: [grantRecipient]
        };
        await networkEntity.performBankTransaction(grant, null, true, false);
        userRecord.balance = INITIAL_BALANCE;
        if (inviteeReward > 0) {
          const inviteeRewardDetails: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "invitee-reward",
            amount: inviteeReward,
            relatedCardId: null,
            relatedCouponId: null,
            toRecipients: [grantRecipient]
          };
          await networkEntity.performBankTransaction(inviteeRewardDetails, null, true, false);
          userRecord.balance += inviteeReward;
        }
      }

      const userStatus = await this.getUserStatus(userRecord, true);
      const registerResponse: RegisterUserResponse = {
        serverVersion: SERVER_VERSION,
        status: userStatus,
        interestRatePerMillisecond: INTEREST_RATE_PER_MILLISECOND,
        subsidyRate: await priceRegulator.getUserSubsidyRate(),
        operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
        operatorAddress: networkEntity.getOperatorAddress(),
        networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
        networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
        referralFraction: networkEntity.getReferralFraction(),
        withdrawalsEnabled: bank.withdrawalsEnabled,
        depositUrl: configuration.get('braintree.enabled', false) ? this.urlManager.getPublicUrl('deposit') : null,
        admin: userRecord.admin
      };
      response.json(registerResponse);
    } catch (err) {
      console.error("User.handleRegisterUser: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async fetchIpAddressInfo(ipAddress: string): Promise<IpAddressRecord> {
    if (ipAddress === "::1" || ipAddress === "localhost" || ipAddress === "127.0.0.1") {
      return null;
    }
    const record = await db.findIpAddress(ipAddress);
    const lifetime = record && record.status === 'success' ? MAX_IP_ADDRESS_LIFETIME : IP_ADDRESS_FAIL_RETRY_INTERVAL;
    if (record && Date.now() - record.lastUpdated < lifetime) {
      return record;
    }
    if (configuration.get('ipAddress.geo.enabled')) {
      if (record) {
        // Don't wait for response
        void this.initiateIpAddressUpdate(ipAddress, null);
        return record;
      } else {
        return await this.initiateIpAddressUpdate(ipAddress, record);
      }
    }
  }

  private async initiateIpAddressUpdate(ipAddress: string, record: IpAddressRecord): Promise<IpAddressRecord> {
    try {
      console.log("User.fetchIpAddressInfo: Fetching geo location for ip " + ipAddress);
      const fetchResponse = await fetch(configuration.get("ipAddress.geo.urlPrefix") + ipAddress + configuration.get("ipAddress.geo.urlSuffix"));
      if (fetchResponse && fetchResponse.status === 200) {
        const json = await fetchResponse.json() as IpApiResponse;
        if (json.status) {
          console.log("User.initiateIpAddressUpdate", ipAddress, json);
          if (record) {
            return await db.updateIpAddress(ipAddress, json.status, json.country, json.countryCode, json.region, json.regionName, json.city, json.zip, json.lat, json.lon, json.timezone, json.isp, json.org, json.as, json.query, json.message);
          } else {
            return await db.insertIpAddress(ipAddress, json.status, json.country, json.countryCode, json.region, json.regionName, json.city, json.zip, json.lat, json.lon, json.timezone, json.isp, json.org, json.as, json.query, json.message);
          }
        } else {
          console.warn("User.initiateIpAddressUpdate: invalid response from ipapi", json);
        }
      } else {
        console.warn("User.initiateIpAddressUpdate: unexpected response from ipapi", fetchResponse);
      }
    } catch (err) {
      console.warn("User.initiateIpAddressUpdate: failure fetching IP geo info", err);
    }
    return null;
  }

  private async handleRegisterDevice(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RegisterDeviceDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.token || !requestBody.detailsObject.type) {
        response.status(400).send("Device token is missing or invalid");
        return;
      }
      console.log("UserManager.register-device", requestBody.detailsObject.address, requestBody.detailsObject);
      const existing = await db.findDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token);
      if (existing) {
        if (user.address !== existing.userAddress) {
          response.status(409).send("This device token is already associated with a different user");
          return;
        }
      } else {
        await db.insertDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token, requestBody.detailsObject.address);
      }
      const reply: RegisterDeviceResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleRegisterDevice: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleSignIn(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as SignInDetails;
      if (!requestBody || !requestBody.handle) {
        response.status(400).send("Missing handle");
        return;
      }
      console.log("UserManager.register-user", requestBody);
      const user = await db.findUserByHandle(requestBody.handle);
      if (!user) {
        response.status(404).send("No user with this handle");
        return;
      }
      if (!user.encryptedPrivateKey) {
        response.status(401).send("The password is incorrect or missing.");
        return;
      }
      const reply: SignInResponse = {
        encryptedPrivateKey: user.encryptedPrivateKey
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleSignIn: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  // private async handleRegisterDevice(request: Request, response: Response): Promise<void> {
  //   try {
  //     const requestBody = request.body as RestRequest<RegisterDeviceDetails>;
  //     const user = await RestHelper.validateRegisteredRequest(requestBody, response);
  //     if (!user) {
  //       return;
  //     }
  //     if (!requestBody.detailsObject.token || !requestBody.detailsObject.type) {
  //       response.status(400).send("Device token is missing or invalid");
  //       return;
  //     }
  //     console.log("UserManager.register-device", requestBody.detailsObject.address, requestBody.detailsObject);
  //     const existing = await db.findDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token);
  //     if (existing) {
  //       if (user.address !== existing.userAddress) {
  //         response.status(409).send("This device token is already associated with a different user");
  //         return;
  //       }
  //     } else {
  //       await db.insertDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token, requestBody.detailsObject.address);
  //     }
  //     const reply: RegisterDeviceResponse = { success: true };
  //     response.json(reply);
  //   } catch (err) {
  //     console.error("User.handleRegisterDevice: Failure", err);
  //     response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
  //   }
  // }

  private async handleStatus(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UserStatusDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      // console.log("UserManager.status", requestBody.detailsObject.address);
      const status = await this.getUserStatus(user, false);
      const result: UserStatusResponse = {
        serverVersion: SERVER_VERSION,
        status: status
      };
      response.json(result);
    } catch (err) {
      console.error("User.handleStatus: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.identity || !user.identity.handle) {
        if (!requestBody.detailsObject.name || !requestBody.detailsObject.handle) {
          response.status(400).send("Missing name and handle");
          return;
        }
        if (!/^[a-z][a-z0-9\_]{2,22}[a-z0-9]$/i.test(requestBody.detailsObject.handle)) {
          response.status(400).send("Invalid handle.  Must start with letter and can only contain letters, digits and/or underscore.");
          return;
        }
        if (!this.isHandlePermissible(requestBody.detailsObject.handle)) {
          response.status(409).send("This handle is not available");
          return;
        }
      }
      if (requestBody.detailsObject.handle) {
        const existing = await db.findUserByHandle(requestBody.detailsObject.handle);
        if (existing && existing.id !== user.id) {
          response.status(409).send("This handle is not available");
          return;
        }
      }
      if (requestBody.detailsObject.emailAddress) {
        const existing = await db.findUserByEmail(requestBody.detailsObject.emailAddress);
        if (existing && existing.id !== user.id) {
          response.status(409).send("This email address is associated with a different account.");
          return;
        }
      }
      console.log("UserManager.update-identity", requestBody.detailsObject);
      await db.updateUserIdentity(user, requestBody.detailsObject.name, Utils.getFirstName(requestBody.detailsObject.name), Utils.getLastName(requestBody.detailsObject.name), requestBody.detailsObject.handle, requestBody.detailsObject.imageUrl, requestBody.detailsObject.location, requestBody.detailsObject.emailAddress, requestBody.detailsObject.encryptedPrivateKey);
      if (configuration.get("notifications.userIdentityChange")) {
        let html = "<div>";
        html += "<div>userId: " + user.id + "</div>";
        html += "<div>name: " + requestBody.detailsObject.name + "</div>";
        html += "<div>handle: " + requestBody.detailsObject.handle + "</div>";
        html += "<div>email: " + requestBody.detailsObject.emailAddress ? requestBody.detailsObject.emailAddress : "not specified" + "</div>";
        html += "<div>location: " + requestBody.detailsObject.location ? requestBody.detailsObject.location : "not specified" + "</div>";
        html += "<div>image: " + requestBody.detailsObject.imageUrl ? '<img style="width:100px;height:auto;" src="' + requestBody.detailsObject.imageUrl + '">' : "not specified" + "< /div>";
        html += "</div>";
        void emailManager.sendInternalNotification("User identity added/updated", "A user has added or updated their identity", html);
      }
      const reply: UpdateUserIdentityResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateIdentity: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleRequestRecoveryCode(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RequestRecoveryCodeDetails;
      let user: UserRecord;
      if (requestBody.handle) {
        user = await db.findUserByHandle(requestBody.handle);
      } else if (requestBody.emailAddress) {
        user = await db.findUserByEmail(requestBody.emailAddress);
      } else {
        response.status(400).send("You must provide handle or email address");
        return;
      }
      if (!user) {
        response.status(400).send("No matching account found.");
        return;
      }
      if (!user.identity || !user.identity.emailAddress) {
        response.status(409).send("This account does not have a recovery email address associated with it.  There is no way to recover the account if you have forgotten the credentials.");
        return;
      }
      console.log("UserManager.request-recovery-code", requestBody);
      let code: string;
      while (true) {
        code = this.generateRecoveryCode();
        try {
          await db.updateUserRecoveryCode(user, code, Date.now() + RECOVERY_CODE_LIFETIME);
          break;
        } catch (err) {
          // collision on recovery code use, try again
        }
      }
      const text = "Your handle: " + user.identity.handle + "\nRecovery code: " + code + "\n\nEnter this information into the Recover Account page";
      let html = "<p>You asked to recover your Channels account.  Enter the following information into the Account Recovery page.</p>";
      html += "<li>Code: " + code + "</li>";
      html += "<li>Handle: " + user.identity.handle + "</li>";
      html += "<p>If you did not request account recovery, you can safely ignore this message.</p>";
      await emailManager.sendNoReplyUserNotification(user.identity.name, user.identity.emailAddress, "Account recovery", text, html);
      const reply: RequestRecoveryCodeResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleRequestRecoveryCode: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleRecoverUser(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RecoverUserDetails>;
      const registeredUser = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!registeredUser) {
        return;
      }
      if (registeredUser.identity && registeredUser.identity.handle) {
        response.status(400).send("You can't recover when you have a current identity. Sign out first.");
        return;
      }
      if (!requestBody.detailsObject.code) {
        response.status(400).send("You need to include the code");
        return;
      }
      const user = await db.findUserByRecoveryCode(requestBody.detailsObject.code);
      if (!user) {
        response.status(404).send("This is not a valid code.");
        return;
      }
      if (user.recoveryCodeExpires < Date.now()) {
        response.status(401).send("This code has expired.");
        return;
      }
      if (!user.identity || !user.identity.handle) {
        response.status(401).send("This account is not suitable for recovery.");
        return;
      }
      if (user.identity.handle !== requestBody.detailsObject.handle) {
        response.status(400).send("Handle does not match account.");
        return;
      }
      console.log("UserManager.recover-user", requestBody.detailsObject);
      await db.deleteUser(registeredUser.id);
      await db.updateUserAddress(user, registeredUser.address, registeredUser.publicKey, requestBody.detailsObject.encryptedPrivateKey ? requestBody.detailsObject.encryptedPrivateKey : registeredUser.encryptedPrivateKey);
      const status = await this.getUserStatus(user, true);
      const result: RecoverUserResponse = {
        serverVersion: SERVER_VERSION,
        status: status,
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        imageUrl: user.identity ? user.identity.imageUrl : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        encryptedPrivateKey: user.encryptedPrivateKey
      };
      response.json(result);
    } catch (err) {
      console.error("User.handleRecoverUser: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("UserManager.get-identity", user.id, requestBody.detailsObject);
      const reply: GetUserIdentityResponse = {
        serverVersion: SERVER_VERSION,
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        imageUrl: user.identity ? fileManager.rewriteFileUrls(user.identity.imageUrl) : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        encryptedPrivateKey: user.encryptedPrivateKey
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetIdentity: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetHandle(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetHandleDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const handle = requestBody.detailsObject ? requestBody.detailsObject.handle : null;
      if (!handle) {
        response.status(400).send("Missing handle");
        return;
      }
      console.log("UserManager.get-handle", user.id, requestBody.detailsObject);
      const found = await db.findUserByHandle(handle);
      if (!found) {
        response.status(404).send("Handle not found");
        return;
      }
      const reply: GetHandleResponse = {
        serverVersion: SERVER_VERSION,
        handle: found.identity ? found.identity.handle : null,
        name: found.identity ? found.identity.name : null,
        imageUrl: found.identity ? fileManager.rewriteFileUrls(found.identity.imageUrl) : null
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetHandle: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleAdminGetUsers(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetUsersDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const users = requestBody.detailsObject.withIdentityOnly ? await db.findUsersWithIdentity(requestBody.detailsObject.limit) : await db.findUsersByLastContact(requestBody.detailsObject.limit);
      console.log("UserManager.admin-get-users", user.id, requestBody.detailsObject);
      const usersWithData: AdminUserInfo[] = [];
      for (const userInfo of users) {
        const cards = await db.findCardsByUserAndTime(0, 0, 500, userInfo.id, false);
        let privateCards = 0;
        let cardRevenue = 0;
        for (const card of cards) {
          privateCards += card.private ? 1 : 0;
          cardRevenue += card.stats.revenue.value;
        }
        let cardsBought = 0;
        let cardsOpened = 0;
        const userCards = await db.findUserCardInfoForUser(userInfo.id);
        for (const userCard of userCards) {
          if (userCard.lastOpened && userCard.lastOpened > 0) {
            cardsOpened++;
          }
          if (userCard.paidToAuthor && userCard.paidToAuthor > 0) {
            cardsBought++;
          }
        }
        const item: AdminUserInfo = {
          user: userInfo,
          cardsPosted: cards.length,
          privateCards: privateCards,
          cardRevenue: cardRevenue,
          cardsBought: cardsBought,
          cardsOpened: cardsOpened
        };
        usersWithData.push(item);
      }
      const reply: AdminGetUsersResponse = {
        serverVersion: SERVER_VERSION,
        users: usersWithData
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleAdminGetUsers: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleAdminSetUserMailingList(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminSetUserMailingListDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const mailingListUser = await db.findUserById(requestBody.detailsObject.userId);
      if (!mailingListUser) {
        response.status(404).send("No such user");
        return;
      }
      await db.updateUserMailingList(mailingListUser, requestBody.detailsObject.mailingList ? true : false);
      console.log("UserManager.admin-set-user-mailing-list", user.id, requestBody.detailsObject);
      const reply: AdminSetUserMailingListResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleAdminSetUserMailingList: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUserById(id: string): Promise<UserRecord> {
    return await db.findUserById(id);
  }

  private async handleCheckHandle(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CheckHandleDetails>;
      let user: UserRecord;
      if (requestBody.signature) {
        user = await RestHelper.validateRegisteredRequest(requestBody, response);
        if (!user) {
          return;
        }
      } else {
        requestBody.detailsObject = JSON.parse(requestBody.details);
      }
      if (!requestBody.detailsObject.handle) {
        response.status(400).send("Missing handle");
        return;
      }
      const reply: CheckHandleResponse = {
        serverVersion: SERVER_VERSION,
        valid: false,
        inUse: false
      };
      if (!/^[a-z][a-z0-9\_]{2,14}[a-z0-9]$/i.test(requestBody.detailsObject.handle)) {
        response.json(reply);
        return;
      }
      reply.valid = true;
      console.log("UserManager.check-handle", requestBody.details);
      const existing = await db.findUserByHandle(requestBody.detailsObject.handle);
      if (existing) {
        if (!user || existing.id !== user.id) {
          reply.inUse = true;
          response.json(reply);
          return;
        }
      }
      response.json(reply);
    } catch (err) {
      console.error("User.handleCheckHandle: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUserStatus(user: UserRecord, updateBalance: boolean): Promise<UserStatus> {
    if (updateBalance) {
      await this.updateUserBalance(user);
    }
    const network = await db.getNetwork();
    const result: UserStatus = {
      goLive: this.goLiveDate,
      userBalance: user.balance,
      userBalanceAt: user.balanceLastUpdated,
      minBalanceAfterWithdrawal: user.minBalanceAfterWithdrawal,
      targetBalance: user.targetBalance,
      inviteCode: user.inviterCode.toUpperCase(),
      invitationsUsed: user.invitationsAccepted,
      invitationsRemaining: user.invitationsRemaining,
      cardBasePrice: await priceRegulator.getBaseCardFee(),
      totalPublisherRevenue: network.totalPublisherRevenue,
      totalCardDeveloperRevenue: network.totalCardDeveloperRevenue,
      publisherSubsidies: await networkEntity.getPublisherSubsidies()
    };
    return result;
  }

  async generateInviteCode(): Promise<string> {
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

  private generateRecoveryCode(): string {
    let result = '';
    result += NON_ZERO_DIGITS[Math.floor(Math.random() * NON_ZERO_DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    return result;
  }

  private isHandlePermissible(handle: string): boolean {
    return BAD_WORDS.indexOf(handle.toLowerCase()) < 0;
  }

  private async updateBalances(): Promise<void> {
    const now = Date.now();
    const users = await db.findUsersForBalanceUpdates(Date.now() - BALANCE_UPDATE_INTERVAL);
    for (const user of users) {
      await this.updateUserBalance(user);
    }
  }

  async updateUserBalance(user: UserRecord): Promise<void> {
    const now = Date.now();
    let subsidy = 0;
    let balanceBelowTarget = false;
    if (user.balanceBelowTarget) {
      const subsidyRate = await priceRegulator.getUserSubsidyRate();
      subsidy = (now - user.balanceLastUpdated) * subsidyRate;
      if (user.targetBalance > user.balance + subsidy) {
        balanceBelowTarget = true;
      } else {
        subsidy = Math.min(subsidy, user.targetBalance - user.balance);
      }
      if (subsidy > 0) {
        const subsidyRecipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "subsidy-recipient"
        };
        const subsidyDetails: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "subsidy",
          amount: subsidy,
          relatedCardId: null,
          relatedCouponId: null,
          toRecipients: [subsidyRecipient]
        };
        await networkEntity.performBankTransaction(subsidyDetails, null, false, false);
        await priceRegulator.onUserSubsidyPaid(subsidy);
      }
    }
    if (now - user.balanceLastUpdated > MIN_INTEREST_INTERVAL) {
      const interest = this.calculateInterestBetween(user.balanceLastUpdated, now, user.balance);
      if (interest > 0) {
        const interestRecipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "interest-recipient"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "interest",
          amount: interest,
          relatedCardId: null,
          relatedCouponId: null,
          toRecipients: [interestRecipient]
        };
        await networkEntity.performBankTransaction(grant, null, true, false);
      }
    }
  }

  private calculateInterestBetween(from: number, to: number, balance: number): number {
    if (from === 0) {
      return 0;
    }
    return (to - from) * balance * INTEREST_RATE_PER_MILLISECOND;
  }

  async onUserSocketMessage(address: string): Promise<UserRecord> {
    const user = await db.findUserByAddress(address);
    if (!user) {
      return null;
    }
    await db.updateLastUserContact(user, Date.now());
    return user;
  }

  isUserAddress(user: UserRecord, address: string): boolean {
    if (user.address === address) {
      return true;
    }
    for (const a of user.addressHistory) {
      if (a.address === address) {
        return true;
      }
    }
    return false;
  }
}

const BAD_WORDS: string[] = ["4r5e",
  "a55",
  "anal",
  "anus",
  "ar5e",
  "arrse",
  "arse",
  "ass",
  "ass_fucker",
  "asses",
  "assfucker",
  "assfukka",
  "asshole",
  "assholes",
  "asswhole",
  "a_s_s",
  "b1tch",
  "ballbag",
  "balls",
  "ballsack",
  "bastard",
  "beastial",
  "beastiality",
  "bellend",
  "bestial",
  "bestiality",
  "biatch",
  "bitch",
  "bitcher",
  "bitchers",
  "bitches",
  "bitchin",
  "bitching",
  "bloody",
  "blow job",
  "blowjob",
  "blowjobs",
  "boiolas",
  "bollock",
  "bollok",
  "boner",
  "boob",
  "boobs",
  "booobs",
  "boooobs",
  "booooobs",
  "booooooobs",
  "breasts",
  "buceta",
  "bugger",
  "bum",
  "bunny fucker",
  "butt",
  "butthole",
  "buttmuch",
  "buttplug",
  "carpet muncher",
  "cawk",
  "chink",
  "cipa",
  "cl1t",
  "clit",
  "clitoris",
  "clits",
  "cnut",
  "cock",
  "cock_sucker",
  "cockface",
  "cockhead",
  "cockmunch",
  "cockmuncher",
  "cocks",
  "cocksuck ",
  "cocksucked ",
  "cocksucker",
  "cocksucking",
  "cocksucks ",
  "cocksuka",
  "cocksukka",
  "cok",
  "cokmuncher",
  "coksucka",
  "coon",
  "cox",
  "crap",
  "cum",
  "cummer",
  "cumming",
  "cums",
  "cumshot",
  "cunilingus",
  "cunillingus",
  "cunnilingus",
  "cunt",
  "cuntlick ",
  "cuntlicker ",
  "cuntlicking ",
  "cunts",
  "cyalis",
  "cyberfuc",
  "cyberfuck ",
  "cyberfucked ",
  "cyberfucker",
  "cyberfuckers",
  "cyberfucking ",
  "d1ck",
  "damn",
  "dick",
  "dickhead",
  "dildo",
  "dildos",
  "dink",
  "dinks",
  "dirsa",
  "dlck",
  "dog_fucker",
  "doggin",
  "dogging",
  "donkeyribber",
  "doosh",
  "duche",
  "dyke",
  "ejaculate",
  "ejaculated",
  "ejaculates ",
  "ejaculating ",
  "ejaculatings",
  "ejaculation",
  "ejakulate",
  "f4nny",
  "fag",
  "fagging",
  "faggitt",
  "faggot",
  "faggs",
  "fagot",
  "fagots",
  "fags",
  "fanny",
  "fannyflaps",
  "fannyfucker",
  "fanyy",
  "fatass",
  "fcuk",
  "fcuker",
  "fcuking",
  "feck",
  "fecker",
  "felching",
  "fellate",
  "fellatio",
  "fingerfuck ",
  "fingerfucked ",
  "fingerfucker ",
  "fingerfuckers",
  "fingerfucking ",
  "fingerfucks ",
  "fistfuck",
  "fistfucked ",
  "fistfucker ",
  "fistfuckers ",
  "fistfucking ",
  "fistfuckings ",
  "fistfucks ",
  "flange",
  "fook",
  "fooker",
  "fuck",
  "fucka",
  "fucked",
  "fucker",
  "fuckers",
  "fuckhead",
  "fuckheads",
  "fuckin",
  "fucking",
  "fuckings",
  "fuckingshitmotherfucker",
  "fuckme ",
  "fucks",
  "fuckwhit",
  "fuckwit",
  "fuckyou",
  "fuck_you",
  "fudge packer",
  "fudgepacker",
  "fuk",
  "fuker",
  "fukker",
  "fukkin",
  "fuks",
  "fukwhit",
  "fukwit",
  "fux",
  "fux0r",
  "f_u_c_k",
  "gangbang",
  "gangbanged ",
  "gangbangs ",
  "gaylord",
  "gaysex",
  "goatse",
  "God",
  "god_dam",
  "god_damned",
  "goddamn",
  "goddamned",
  "hardcoresex ",
  "hell",
  "heshe",
  "hoar",
  "hoare",
  "hoer",
  "homo",
  "hore",
  "horniest",
  "horny",
  "hotsex",
  "jack_off ",
  "jackoff",
  "jap",
  "jerk_off ",
  "jism",
  "jiz ",
  "jizm ",
  "jizz",
  "kawk",
  "knob",
  "knobead",
  "knobed",
  "knobend",
  "knobhead",
  "knobjocky",
  "knobjokey",
  "kock",
  "kondum",
  "kondums",
  "kum",
  "kummer",
  "kumming",
  "kums",
  "kunilingus",
  "l3itch",
  "labia",
  "lmfao",
  "lust",
  "lusting",
  "m45terbate",
  "ma5terb8",
  "ma5terbate",
  "masochist",
  "master_bate",
  "masterb8",
  "masterbat*",
  "masterbat3",
  "masterbate",
  "masterbation",
  "masterbations",
  "masturbate",
  "mo_fo",
  "mof0",
  "mofo",
  "mothafuck",
  "mothafucka",
  "mothafuckas",
  "mothafuckaz",
  "mothafucked ",
  "mothafucker",
  "mothafuckers",
  "mothafuckin",
  "mothafucking ",
  "mothafuckings",
  "mothafucks",
  "mother fucker",
  "motherfuck",
  "motherfucked",
  "motherfucker",
  "motherfuckers",
  "motherfuckin",
  "motherfucking",
  "motherfuckings",
  "motherfuckka",
  "motherfucks",
  "muff",
  "mutha",
  "muthafecker",
  "muthafuckker",
  "muther",
  "mutherfucker",
  "n1gga",
  "n1gger",
  "nazi",
  "nigg3r",
  "nigg4h",
  "nigga",
  "niggah",
  "niggas",
  "niggaz",
  "nigger",
  "niggers ",
  "nob",
  "nob jokey",
  "nobhead",
  "nobjocky",
  "nobjokey",
  "numbnuts",
  "nutsack",
  "orgasim ",
  "orgasims ",
  "orgasm",
  "orgasms ",
  "p0rn",
  "pawn",
  "pecker",
  "penis",
  "penisfucker",
  "phonesex",
  "phuck",
  "phuk",
  "phuked",
  "phuking",
  "phukked",
  "phukking",
  "phuks",
  "phuq",
  "pigfucker",
  "pimpis",
  "piss",
  "pissed",
  "pisser",
  "pissers",
  "pisses ",
  "pissflaps",
  "pissin ",
  "pissing",
  "pissoff ",
  "poop",
  "porn",
  "porno",
  "pornography",
  "pornos",
  "prick",
  "pricks ",
  "pron",
  "pube",
  "pusse",
  "pussi",
  "pussies",
  "pussy",
  "pussys ",
  "rectum",
  "retard",
  "rimjaw",
  "rimming",
  "sadist",
  "schlong",
  "screwing",
  "scroat",
  "scrote",
  "scrotum",
  "semen",
  "sex",
  "sh1t",
  "shag",
  "shagger",
  "shaggin",
  "shagging",
  "shemale",
  "shit",
  "shitdick",
  "shite",
  "shited",
  "shitey",
  "shitfuck",
  "shitfull",
  "shithead",
  "shiting",
  "shitings",
  "shits",
  "shitted",
  "shitter",
  "shitters ",
  "shitting",
  "shittings",
  "shitty ",
  "skank",
  "slut",
  "sluts",
  "smegma",
  "smut",
  "snatch",
  "son_of_a_bitch",
  "spac",
  "spunk",
  "s_h_i_t",
  "t1tt1e5",
  "t1tties",
  "teets",
  "teez",
  "testical",
  "testicle",
  "tit",
  "titfuck",
  "tits",
  "titt",
  "tittie5",
  "tittiefucker",
  "titties",
  "tittyfuck",
  "tittywank",
  "titwank",
  "tosser",
  "turd",
  "tw4t",
  "twat",
  "twathead",
  "twatty",
  "twunt",
  "twunter",
  "v14gra",
  "v1gra",
  "vagina",
  "viagra",
  "vulva",
  "w00se",
  "wang",
  "wank",
  "wanker",
  "wanky",
  "whoar",
  "whore",
  "willies",
  "willy",
  "xrated",
  "xxx"
];

const userManager = new UserManager();

export { userManager };

interface IpApiResponse {
  status: IpAddressStatus;
  country: string;
  countryCode: string;
  region: string;
  regionName: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  "as": string;
  query: string;
  message: string;
}
