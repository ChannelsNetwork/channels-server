import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { SERVER_VERSION } from "./server-version";
import { RestRequest, QueryPageDetails, QueryPageResponse, AdminGetGoalsDetails, AdminGetGoalsResponse, AdminGoalsInfo, AdminUserGoalsInfo, AdminCardGoalsInfo, AdminGetWithdrawalsDetails, AdminGetWithdrawalsResponse, ManualWithdrawalInfo, AdminUpdateWithdrawalDetails, AdminUpdateWithdrawalResponse } from "./interfaces/rest-services";
import * as moment from "moment-timezone";
import { db } from "./db";
import { CardRecord, UserRecord, UserCardActionRecord } from "./interfaces/db-records";

export class AdminManager implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('admin-goals'), (request: Request, response: Response) => {
      void this.handleGetAdminGoals(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-withdrawals'), (request: Request, response: Response) => {
      void this.handleGetWithdrawals(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-update-withdrawal'), (request: Request, response: Response) => {
      void this.handleUpdateWithdrawal(request, response);
    });
  }
  private async handleGetAdminGoals(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetGoalsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      console.log("AdminManager.admin-goals", user.id, requestBody.detailsObject);
      const now = Date.now();
      const today = +moment().tz('America/Los_Angeles').startOf('day');
      const yesterday = today - 1000 * 60 * 60 * 24;
      const twoDaysAgo = yesterday - 1000 * 60 * 60 * 24;
      const threeDaysAgo = twoDaysAgo - 1000 * 60 * 60 * 24;
      const reply: AdminGetGoalsResponse = {
        serverVersion: SERVER_VERSION,
        today: await this.computeGoals(today, now),
        yesterday: await this.computeGoals(yesterday, today),
        twoDaysAgo: await this.computeGoals(twoDaysAgo, yesterday),
        threeDaysAgo: await this.computeGoals(threeDaysAgo, twoDaysAgo),
        past7Days: null,
        pastMonth: null,
        total: null
      };
      response.json(reply);
    } catch (err) {
      console.error("AdminManager.handleGetAdminGoals: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async computeGoals(from: number, to: number): Promise<AdminGoalsInfo> {
    const result: AdminGoalsInfo = {
      users: await this.computeUserGoals(from, to),
      cards: await this.computeCardGoals(from, to)
    };
    return result;
  }

  private async computeUserGoals(from: number, to: number): Promise<AdminUserGoalsInfo> {
    const result: AdminUserGoalsInfo = {
      newUsers: 0,
      active: 0,
      withIdentity: {
        newUsers: 0,
        returningUsers: 0,
        active: 0,
        nonViewers: 0,
        oneTimeViewers: 0,
        multipleViewers: 0,
        posters: 0
      },
      anonymous: {
        newUsers: 0,
        returningUsers: 0,
        active: 0,
        nonViewers: 0,
        oneTimeViewers: 0,
        multipleViewers: 0
      }
    };
    const cursor = db.getUserCursorByLastContact(from, Date.now(), to);
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      // console.log("User", user.identity ? user.identity.name : user.address, new Date(user.lastContact).toString(), new Date(from).toString(), new Date(to).toString());
      const actions = await db.countUserCardActionsInTimeframe(user.id, from, to);
      if (user.added > from) {
        result.newUsers++;
      }
      if (actions > 0) {
        result.active++;
        if (user.identity && user.identity.handle) {
          if (actions > 0) {
            result.withIdentity.active++;
          }
          if (user.added > from) {
            result.withIdentity.newUsers++;
          }
          if (user.lastContact - user.added > 1000 * 60 * 60 * 12) {
            result.withIdentity.returningUsers++;
          }
          const views = await db.countUserCardsPaidInTimeframe(user.id, from, to);
          if (views === 0) {
            result.withIdentity.nonViewers++;
          } else if (views === 1) {
            result.withIdentity.oneTimeViewers++;
          } else {
            result.withIdentity.multipleViewers++;
          }
          const posts = await db.countCardPostsByUser(user.id, from, to);
          if (posts > 0) {
            result.withIdentity.posters++;
          }
        } else {
          result.anonymous.active++;
          if (user.added > from) {
            result.anonymous.newUsers++;
          }
          if (user.lastContact - user.added > 1000 * 60 * 60 * 12) {
            result.anonymous.returningUsers++;
          }
          const views = await db.countUserCardsPaidInTimeframe(user.id, from, to);
          if (views === 0) {
            result.anonymous.nonViewers++;
          } else if (views === 1) {
            result.anonymous.oneTimeViewers++;
          } else {
            result.anonymous.multipleViewers++;
          }
        }
      }
    }
    return result;
  }

  private async computeCardGoals(from: number, to: number): Promise<AdminCardGoalsInfo> {
    const result: AdminCardGoalsInfo = {
      payFor: {
        firstTimePosts: 0,
        totalPosts: 0,
        purchases: 0,
        firstTimePurchases: 0
      },
      promoted: {
        impressionBased: {
          firstTimePosts: 0,
          totalPosts: 0,
          totalImpressions: 0,
          usersWithImpressions: 0,
          totalClicks: 0,
          usersWhoClicked: 0
        },
        openBased: {
          firstTimePosts: 0,
          totalPosts: 0,
          totalImpressions: 0,
          usersWithImpressions: 0,
          totalPaymentCount: 0,
          usersWhoWerePaid: 0
        }
      }
    };
    const cursor = db.getUserCardActionsFromTo(from, to);
    const cardsById: { [id: string]: CardRecord } = {};
    const usersById: { [id: string]: UserRecord } = {};
    const firstPurchasesByUser: { [userId: string]: UserCardActionRecord } = {};
    const userImpressionsImpressionBased: string[] = [];
    const userImpressionsOpenBased: string[] = [];
    const userClicksImpressionBased: string[] = [];
    const userPaidOpenBased: string[] = [];
    while (await cursor.hasNext()) {
      const action = await cursor.next();
      let card = cardsById[action.cardId];
      if (!card) {
        card = await db.findCardById(action.cardId, true, false);
        if (card) {
          cardsById[card.id] = card;
          if (card.postedAt > from && card.postedAt <= to) {
            const firstCardByAuthor = await db.findFirstCardByUser(card.createdById);
            if (card.pricing.openFeeUnits) {
              result.payFor.totalPosts++;
              if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
                result.payFor.firstTimePosts++;
              }
            } else if (card.pricing.promotionFee > 0) {
              result.promoted.impressionBased.totalPosts++;
              if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
                result.promoted.impressionBased.firstTimePosts++;
              }
            } else {
              result.promoted.openBased.totalPosts++;
              if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
                result.promoted.openBased.firstTimePosts++;
              }
            }
          }
        }
      }
      if (card) {
        if (card.pricing.openFeeUnits) {
          if (action.action === 'pay') {
            result.payFor.purchases++;
            let firstPay = firstPurchasesByUser[action.userId];
            if (!firstPay) {
              firstPay = await db.findFirstUserCardActionByUser(action.userId, "pay");
              firstPurchasesByUser[action.userId] = firstPay;
            }
            if (firstPay && firstPay.at === action.at) {
              result.payFor.firstTimePurchases++;
            }
          }
        } else if (card.pricing.promotionFee > 0) {
          switch (action.action) {
            case "impression":
              result.promoted.impressionBased.totalImpressions++;
              if (userImpressionsImpressionBased.indexOf(action.userId) < 0) {
                result.promoted.impressionBased.usersWithImpressions++;
                userImpressionsImpressionBased.push(action.userId);
              }
              break;
            case "click":
            case "open":
              result.promoted.impressionBased.totalClicks++;
              if (userClicksImpressionBased.indexOf(action.userId) < 0) {
                result.promoted.impressionBased.usersWhoClicked++;
                userClicksImpressionBased.push(action.userId);
              }
              break;
            default:
              break;
          }
        } else {
          switch (action.action) {
            case "impression":
              result.promoted.openBased.totalImpressions++;
              if (userImpressionsOpenBased.indexOf(action.userId) < 0) {
                result.promoted.openBased.usersWithImpressions++;
                userImpressionsOpenBased.push(action.userId);
              }
              break;
            case "redeem-open-payment":
              result.promoted.openBased.totalPaymentCount++;
              if (userPaidOpenBased.indexOf(action.userId) < 0) {
                result.promoted.openBased.usersWhoWerePaid++;
                userPaidOpenBased.push(action.userId);
              }
              break;
            default:
              break;
          }
        }
      }
    }
    return result;
  }

  private async handleGetWithdrawals(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetWithdrawalsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      console.log("AdminManager.admin-get-withdrawals", user.id, requestBody.detailsObject);
      const withdrawals: ManualWithdrawalInfo[] = [];
      const records = await db.listManualWithdrawals(requestBody.detailsObject.limit);
      for (const record of records) {
        let lastUpdatedByName: string;
        if (record.lastUpdatedBy) {
          const lastUpdateByUser = await db.findUserById(record.lastUpdatedBy);
          if (lastUpdateByUser) {
            lastUpdatedByName = lastUpdateByUser.identity.name;
          }
        }
        const withdrawal: ManualWithdrawalInfo = {
          record: record,
          user: {
            id: null,
            handle: null,
            email: null,
            name: null,
            balance: null
          },
          lastUpdatedByName: lastUpdatedByName
        };
        const withdrawalUser = await db.findUserById(record.userId);
        if (withdrawalUser) {
          withdrawal.user.id = withdrawalUser.id;
          withdrawal.user.handle = withdrawalUser.identity.handle;
          withdrawal.user.email = withdrawalUser.identity.emailAddress;
          withdrawal.user.name = withdrawalUser.identity.name;
          withdrawal.user.balance = withdrawalUser.balance;
        }
        withdrawals.push(withdrawal);
      }
      const reply: AdminGetWithdrawalsResponse = {
        serverVersion: SERVER_VERSION,
        withdrawals: withdrawals
      };
      response.json(reply);
    } catch (err) {
      console.error("AdminManager.handleGetWithdrawals: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateWithdrawal(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminUpdateWithdrawalDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      console.log("AdminManager.admin-update-withdrawal", user.id, requestBody.detailsObject);
      const record = await db.findManualWithdrawalById(requestBody.detailsObject.id);
      if (!record) {
        response.status(404).send("No such record");
        return;
      }
      await db.updateManualWithdrawal(record.id, requestBody.detailsObject.state, requestBody.detailsObject.state === "paid" ? requestBody.detailsObject.paymentReferenceId : null, user.id);
      const reply: AdminUpdateWithdrawalResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("AdminManager.handleUpdateWithdrawal: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const adminManager = new AdminManager();

export { adminManager };
