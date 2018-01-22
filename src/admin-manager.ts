import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { SERVER_VERSION } from "./server-version";
import { RestRequest, QueryPageDetails, QueryPageResponse, AdminGetGoalsDetails, AdminGetGoalsResponse, AdminGoalsInfo, AdminUserGoalsInfo, AdminCardGoalsInfo, AdminGetWithdrawalsDetails, AdminGetWithdrawalsResponse, ManualWithdrawalInfo, AdminUpdateWithdrawalDetails, AdminUpdateWithdrawalResponse, AdminPublisherRevenueGoalsInfo, AdminAdRevenueGoalsInfo, AdminPublisherGoalsInfo } from "./interfaces/rest-services";
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
      const reply: AdminGetGoalsResponse = {
        serverVersion: SERVER_VERSION,
        days: []
      };
      let ending = Date.now();
      let starting = +moment().tz('America/Los_Angeles').startOf('day');
      for (let i = 0; i < 7; i++) {
        reply.days.push(await this.computeGoals(starting, ending));
        ending = starting;
        starting -= 1000 * 60 * 60 * 24;
      }
      response.json(reply);
    } catch (err) {
      console.error("AdminManager.handleGetAdminGoals: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async computeGoals(from: number, to: number): Promise<AdminGoalsInfo> {
    const result: AdminGoalsInfo = {
      dayStarting: from,
      users: await this.computeUserGoals(from, to),
      publishers: await this.computePublisherGoals(from, to),
      cards: await this.computeCardGoals(from, to),
      publisherRevenue: await this.computePublisherRevenueGoals(from, to),
      adRevenue: await this.computeAdRevenueGoals(from, to)
    };
    return result;
  }

  private async computeUserGoals(from: number, to: number): Promise<AdminUserGoalsInfo> {
    const result: AdminUserGoalsInfo = {
      total: 0,
      totalWithIdentity: 0,
      newUsers: 0,
      newUsersWithIdentity: 0,
      activeUsers: 0,
      activeUsersWithIdentity: 0,
      returningUsers: 0,
      returningUsersWithIdentity: 0
    };
    result.total = await db.countTotalUsersBefore(to);
    result.totalWithIdentity = await db.countTotalUsersWithIdentity(to);
    const userIds = await db.findDistinctUsersActiveBetween(from, to);
    const cursor = db.getUsersById(userIds);
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      if (user.added >= from) {
        result.newUsers++;
        if (user.identity && user.identity.handle) {
          result.newUsersWithIdentity++;
        }
      }
      result.activeUsers++;
      if (user.identity && user.identity.handle) {
        result.activeUsersWithIdentity++;
      }
      if (user.added < from) {
        result.returningUsers++;
        if (user.identity && user.identity.handle) {
          result.returningUsersWithIdentity++;
        }
      }
    }
    return result;
  }

  private async computePublisherGoals(from: number, to: number): Promise<AdminPublisherGoalsInfo> {
    const result: AdminPublisherGoalsInfo = {
      total: 0,
      newPublishers: 0,
      posted: 0
    };
    result.total = await db.countDistinctCardOwners(0, to);
    result.newPublishers = result.total - await db.countDistinctCardOwners(0, from);
    result.posted = await db.countDistinctCardOwners(from, to);
    return result;
  }

  private async computeCardGoals(from: number, to: number): Promise<AdminCardGoalsInfo> {
    const result: AdminCardGoalsInfo = {
      total: 0,
      totalNonPromoted: 0,
      totalPromoted: 0,
      totalAds: 0,
      newCards: 0,
      newNonPromoted: 0,
      newPromoted: 0,
      newAds: 0
    };
    result.total = await db.countCards(to, 0);
    result.totalNonPromoted = await db.countNonPromotedCards(to, 0);
    result.totalPromoted = await db.countPromotedCards(to, 0);
    result.totalAds = await db.countAdCards(to, 0);

    result.newCards = await db.countCards(to, from);
    result.newNonPromoted = await db.countNonPromotedCards(to, from);
    result.newPromoted = await db.countPromotedCards(to, from);
    result.newAds = await db.countAdCards(to, from);
    return result;
  }

  private async computePublisherRevenueGoals(from: number, to: number): Promise<AdminPublisherRevenueGoalsInfo> {
    const result: AdminPublisherRevenueGoalsInfo = {
      totalCardsOpened: 0,
      totalCardsPurchased: 0,
      totalCardsFullPrice: 0,
      totalCardsDiscounted: 0,
      totalRevenue: 0,
      newCardsOpened: 0,
      newCardsPurchased: 0,
      newCardsFullPrice: 0,
      newCardsDiscounted: 0,
      newRevenue: ""
    };
    result.totalCardsOpened = await db.countUserCardOpens(to, 0);
    result.totalCardsPurchased = await db.countBankTransactionsByReason("card-open-fee", to, 0);
    result.totalCardsDiscounted = await db.countBankTransactionsByReasonWithAmount("card-open-fee", to, 0, 0.000001);
    result.totalCardsFullPrice = result.totalCardsPurchased - result.totalCardsDiscounted;
    result.totalRevenue = await db.totalBankTransactionsAmountByReason("card-open-fee", to, 0);

    result.newCardsOpened = await db.countUserCardOpens(to, from);
    result.newCardsPurchased = await db.countBankTransactionsByReason("card-open-fee", to, from);
    result.newCardsDiscounted = await db.countBankTransactionsByReasonWithAmount("card-open-fee", to, from, 0.000001);
    result.newCardsFullPrice = result.totalCardsPurchased - result.totalCardsDiscounted;
    result.newRevenue = (await db.totalBankTransactionsAmountByReason("card-open-fee", to, from)).toFixed(2);
    return result;
  }

  private async computeAdRevenueGoals(from: number, to: number): Promise<AdminAdRevenueGoalsInfo> {
    const result: AdminAdRevenueGoalsInfo = {
      totalImpressions: 0,
      totalPromotedOpens: 0,
      totalPromotedRevenue: "",
      totalAdRevenue: "",
      newImpressions: 0,
      newPromotedOpens: 0,
      newPromotedRevenue: "",
      newAdRevenue: ""
    };
    result.totalImpressions = await db.countBankTransactionsByReason("card-promotion", to, 0);
    result.totalPromotedOpens = await db.countBankTransactionsByReason("card-open-payment", to, 0);
    result.totalPromotedRevenue = (await db.totalBankTransactionsAmountByReason("card-promotion", to, 0)).toFixed(2);
    result.totalAdRevenue = (await db.totalBankTransactionsAmountByReason("card-open-payment", to, 0)).toFixed(2);
    result.newImpressions = await db.countBankTransactionsByReason("card-promotion", to, from);
    result.newPromotedOpens = await db.countBankTransactionsByReason("card-open-payment", to, from);
    result.newPromotedRevenue = (await db.totalBankTransactionsAmountByReason("card-promotion", to, from)).toFixed(2);
    result.newAdRevenue = (await db.totalBankTransactionsAmountByReason("card-open-payment", to, from)).toFixed(2);
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
