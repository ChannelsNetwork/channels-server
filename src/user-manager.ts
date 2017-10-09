import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, RegisterDeviceDetails, UserStatusDetails, Signable, RegisterDeviceResponse, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, GetSyncCodeDetails, GetSyncCodeResponse, SyncIdentityDetails, SyncIdentityResponse, BankTransactionRecipientDirective, BankTransactionDetails } from "./interfaces/rest-services";
import { db } from "./db";
import { UserRecord } from "./interfaces/db-records";
import * as NodeRSA from "node-rsa";
import { UrlManager } from "./url-manager";
import { KeyUtils, KeyInfo } from "./key-utils";
import { RestHelper } from "./rest-helper";
import * as url from 'url';
import { UserHelper } from "./user-helper";
import { socketServer, UserSocketHandler } from "./socket-server";
import { priceRegulator } from "./price-regulator";
import { networkEntity } from "./network-entity";
import { Initializable } from "./interfaces/initializable";

const INITIAL_BALANCE = 10;
const INVITER_REWARD = 2;
const INVITEE_REWARD = 2;
const INVITATIONS_ALLOWED = 5;
const LETTERS = 'abcdefghjklmnpqrstuvwxyz';
const NON_ZERO_DIGITS = '123456789';
const DIGITS = '0123456789';
const NETWORK_BALANCE_RANDOM_PRODUCT = 1.5;
const ANNUAL_INTEREST_RATE = 0.3;
const INTEREST_RATE_PER_MILLISECOND = Math.pow(1 + ANNUAL_INTEREST_RATE, 1 / (365 * 24 * 60 * 60 * 1000)) - 1;
const BALANCE_UPDATE_INTERVAL = 1000 * 60 * 15;
const SYNC_CODE_LIFETIME = 1000 * 60 * 5;

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
    this.app.post(this.urlManager.getDynamicUrl('account-status'), (request: Request, response: Response) => {
      void this.handleStatus(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-identity'), (request: Request, response: Response) => {
      void this.handleUpdateIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-sync-code'), (request: Request, response: Response) => {
      void this.handleGetSyncCode(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('sync-identity'), (request: Request, response: Response) => {
      void this.handleSyncIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-identity'), (request: Request, response: Response) => {
      void this.handleGetIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('check-handle'), (request: Request, response: Response) => {
      void this.handleCheckHandle(request, response);
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
      let userRecord = await db.findUserByAddress(requestBody.detailsObject.address);
      if (!userRecord) {
        const inviter = await db.findUserByInviterCode(requestBody.detailsObject.inviteCode);
        let inviteeReward = 0;
        if (inviter && inviter.invitationsRemaining > 0) {
          await db.incrementInvitationsAccepted(inviter, INVITER_REWARD);
          const rewardRecipient: BankTransactionRecipientDirective = {
            address: inviter.keys[0].address,
            portion: "remainder"
          };
          const reward: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "inviter-reward",
            amount: INVITER_REWARD,
            toRecipients: [rewardRecipient]
          };
          await networkEntity.performBankTransaction(reward, true);
          inviteeReward = INVITEE_REWARD;
        }
        const inviteCode = await this.generateInviteCode();
        userRecord = await db.insertUser("normal", requestBody.detailsObject.address, requestBody.detailsObject.publicKey, requestBody.detailsObject.inviteCode, inviteCode, INVITATIONS_ALLOWED, 0);
        const grantRecipient: BankTransactionRecipientDirective = {
          address: requestBody.detailsObject.address,
          portion: "remainder"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "grant",
          amount: INITIAL_BALANCE,
          toRecipients: [grantRecipient]
        };
        await networkEntity.performBankTransaction(grant, true);
        userRecord.balance = INITIAL_BALANCE;
        if (inviteeReward > 0) {
          const inviteeRewardDetails: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "invitee-reward",
            amount: inviteeReward,
            toRecipients: [grantRecipient]
          };
          await networkEntity.performBankTransaction(inviteeRewardDetails, true);
          userRecord.balance += inviteeReward;
        }
      }
      await this.returnUserStatus(userRecord, response);
    } catch (err) {
      console.error("User.handleRegisterUser: Failure", err);
      response.status(500).send(err);
    }
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
        if (!UserHelper.isUsersAddress(user, existing.userAddress)) {
          response.status(409).send("This device token is already associated with a different user");
          return;
        }
      } else {
        await db.insertDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token, requestBody.detailsObject.address);
      }
      const reply: RegisterDeviceResponse = { success: true };
      response.json(reply);
    } catch (err) {
      console.error("User.handleRegisterDevice: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleStatus(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UserStatusDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("UserManager.status", requestBody.detailsObject.address);
      await this.returnUserStatus(user, response);
    } catch (err) {
      console.error("User.handleStatus: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleUpdateIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
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
      }
      console.log("UserManager.update-identity", requestBody.detailsObject);
      const existing = await db.findUserByHandle(requestBody.detailsObject.handle);
      if (existing && existing.id !== user.id) {
        response.status(409).send("This handle is not available");
        return;
      }
      await db.updateUserIdentity(user, requestBody.detailsObject.name, requestBody.detailsObject.handle, requestBody.detailsObject.imageUrl, requestBody.detailsObject.location, requestBody.detailsObject.emailAddress);
      const reply: UpdateUserIdentityResponse = {};
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateIdentity: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleGetSyncCode(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetSyncCodeDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.identity || !user.identity.handle) {
        response.status(403).send("You must have a handle to get a sync code");
        return;
      }
      console.log("UserManager.get-sync-code", requestBody.detailsObject);
      const syncCode = this.generateSyncCode();
      await db.updateUserSyncCode(user, syncCode, Date.now() + SYNC_CODE_LIFETIME);
      const reply: GetSyncCodeResponse = {
        syncCode: syncCode
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetSyncCode: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleSyncIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<SyncIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("UserManager.sync-identity", requestBody.detailsObject);
      if (!requestBody.detailsObject.handle || !requestBody.detailsObject.syncCode) {
        response.status(400).send("You must provide existing user handle and syncCode");
        return;
      }
      const syncUser = await db.findUserByHandle(requestBody.detailsObject.handle);
      if (!syncUser) {
        response.status(404).send("No such handle");
        return;
      }
      if (syncUser.syncCode !== requestBody.detailsObject.syncCode || !syncUser.syncCodeExpires || Date.now() > syncUser.syncCodeExpires) {
        response.status(401).send("This code is not valid or has expired");
        return;
      }
      let publicKey: string;
      for (const k of user.keys) {
        if (k.address === requestBody.detailsObject.address) {
          publicKey = k.publicKey;
          break;
        }
      }
      if (user.keys.length > 1) {
        await db.updateUserRemoveAddress(requestBody.detailsObject.address);
      } else {
        await db.deleteUser(requestBody.detailsObject.address);
      }
      await db.updateUserAddAddress(syncUser, requestBody.detailsObject.address, publicKey);
      await this.returnUserStatus(syncUser, response);
    } catch (err) {
      console.error("User.handleSyncIdentity: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleGetIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("UserManager.get-identity", requestBody.detailsObject);
      const reply: GetUserIdentityResponse = {
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        imageUrl: user.identity ? user.identity.imageUrl : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        settings: {
          displayNetworkBalance: user.admin
        }
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetIdentity: Failure", err);
      response.status(500).send(err);
    }
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
      const reply: CheckHandleResponse = { valid: false, inUse: false };
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
      response.status(500).send(err);
    }
  }

  private async returnUserStatus(user: UserRecord, response: Response): Promise<void> {
    const network = await db.getNetwork();
    await this.updateUserBalance(user);
    const result = await this.getUserStatus(user);
    response.json(result);
  }

  async getUserStatus(user: UserRecord): Promise<UserStatusResponse> {
    const result: UserStatusResponse = {
      status: {
        goLive: this.goLiveDate,
        userBalance: user.balance,
        userBalanceAt: user.balanceLastUpdated,
        withdrawableBalance: user.withdrawableBalance,
        targetBalance: user.targetBalance,
        inviteCode: user.inviterCode.toUpperCase(),
        invitationsUsed: user.invitationsAccepted,
        invitationsRemaining: user.invitationsRemaining
      },
      interestRatePerMillisecond: INTEREST_RATE_PER_MILLISECOND,
      cardBasePrice: await priceRegulator.getBaseCardFee(),
      subsidyRate: await priceRegulator.getUserSubsidyRate()
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

  private generateSyncCode(): string {
    let result = '';
    result += NON_ZERO_DIGITS[Math.floor(Math.random() * NON_ZERO_DIGITS.length)];
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

  private async updateUserBalance(user: UserRecord): Promise<void> {
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
          address: user.keys[0].address,
          portion: "remainder"
        };
        const subsidyDetails: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "subsidy",
          amount: subsidy,
          toRecipients: [subsidyRecipient]
        };
        await networkEntity.performBankTransaction(subsidyDetails, false);
        await priceRegulator.onUserSubsidyPaid(subsidy);
      }
    }
    const interest = this.calculateInterestBetween(user.balanceLastUpdated, now, user.balance);
    if (interest > 0) {
      const interestRecipient: BankTransactionRecipientDirective = {
        address: user.keys[0].address,
        portion: "remainder"
      };
      const grant: BankTransactionDetails = {
        timestamp: null,
        address: null,
        type: "transfer",
        reason: "interest",
        amount: interest,
        toRecipients: [interestRecipient]
      };
      await networkEntity.performBankTransaction(grant, true);
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

  async insertUser(id: string, address: string, publicKey: string, name: string, imageUrl: string): Promise<UserRecord> {
    const inviteCode = await this.generateInviteCode();
    return await db.insertUser("normal", address, publicKey, null, inviteCode, 0, 0, id);
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
