import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { SERVER_VERSION } from "./server-version";
import { RestRequest, QueryPageDetails, QueryPageResponse, AdminGetGoalsDetails, AdminGetGoalsResponse, AdminGoalsInfo, AdminUserGoalsInfo, AdminCardGoalsInfo, AdminGetWithdrawalsDetails, AdminGetWithdrawalsResponse, ManualWithdrawalInfo, AdminUpdateWithdrawalDetails, AdminUpdateWithdrawalResponse, AdminPublisherRevenueGoalsInfo, AdminAdRevenueGoalsInfo, AdminPublisherGoalsInfo, AdminGetPublishersDetails, AdminGetPublishersResponse, AdminPublisherInfo } from "./interfaces/rest-services";
import * as moment from "moment-timezone";
import { db } from "./db";
import { CardRecord, UserRecord, UserCardActionRecord } from "./interfaces/db-records";
import { errorManager } from "./error-manager";
import { Utils } from "./utils";
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
    this.app.post(this.urlManager.getDynamicUrl('admin-publishers'), (request: Request, response: Response) => {
      void this.handleGetAdminPublishers(request, response);
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
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      console.log("AdminManager.admin-goals", user.id, requestBody.detailsObject);
      // const ending = Date.now();
      let starting = +moment().tz('America/Los_Angeles').startOf('day');
      let periodsStarting: number[] = [Date.now()];
      for (let i = 0; i < 7; i++) {
        periodsStarting.push(starting);
        // reply.days.push(await this.computeGoals(starting, ending));
        // ending = starting;
        starting -= 1000 * 60 * 60 * 24;
      }
      periodsStarting.push(0);
      periodsStarting = periodsStarting.reverse();

      const binnedUsers = await db.binUsersByAddedDate(periodsStarting);
      const binnedCards = await db.binCardsByDate(periodsStarting);
      const binnedPayments = await db.binCardPayments(periodsStarting);
      const binnedAdSlots = await db.binAdSlots(periodsStarting);
      const reply: AdminGetGoalsResponse = {
        serverVersion: SERVER_VERSION,
        periodsStarting: periodsStarting,
        userBins: binnedUsers,
        cardBins: binnedCards,
        cardPaymentBins: binnedPayments,
        adSlotBins: binnedAdSlots
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("AdminManager.handleGetAdminGoals: Failure", request, err);
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
    const starting = Date.now();
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
    await cursor.close();
    console.log("Admin.computeUserGoals took " + ((Date.now() - starting) / 1000).toFixed(1) + " seconds");
    return result;
  }

  private async computePublisherGoals(from: number, to: number): Promise<AdminPublisherGoalsInfo> {
    const result: AdminPublisherGoalsInfo = {
      total: 0,
      newPublishers: 0,
      posted: 0
    };
    const starting = Date.now();
    result.total = await db.countDistinctCardOwners(0, to);
    result.newPublishers = result.total - await db.countDistinctCardOwners(0, from);
    result.posted = await db.countDistinctCardOwners(from, to);
    console.log("Admin.computePublisherGoals took " + ((Date.now() - starting) / 1000).toFixed(1) + " seconds");
    return result;
  }

  private async computeCardGoals(from: number, to: number): Promise<AdminCardGoalsInfo> {
    const result: AdminCardGoalsInfo = {
      total: 0,
      totalNonPromoted: 0,
      totalPromoted: 0,
      totalAds: 0,
      totalPaidOpens: 0,
      totalFirstTimePaidOpens: 0,
      totalNormalPaidOpens: 0,
      totalFanPaidOpens: 0,
      totalGrossRevenue: 0,
      totalWeightedRevenue: 0,
      newCards: 0,
      newNonPromoted: 0,
      newPromoted: 0,
      newAds: 0,
      newPaidOpens: 0,
      newFirstTimePaidOpens: 0,
      newNormalPaidOpens: 0,
      newFanPaidOpens: 0,
      newGrossRevenue: 0,
      newWeightedRevenue: 0
    };
    const starting = Date.now();
    result.total = await db.countCards(to, 0);
    result.totalNonPromoted = await db.countNonPromotedCards(to, 0);
    result.totalPromoted = await db.countPromotedCards(to, 0);
    result.totalAds = await db.countAdCards(to, 0);
    const currentStats = await db.getNetworkCardStatsAt(to, true);
    result.totalPaidOpens = currentStats.stats.paidOpens;
    result.totalFirstTimePaidOpens = currentStats.stats.firstTimePaidOpens;
    result.totalNormalPaidOpens = currentStats.stats.paidOpens - currentStats.stats.firstTimePaidOpens;
    result.totalFanPaidOpens = currentStats.stats.fanPaidOpens;
    result.totalGrossRevenue = Utils.roundToDecimal(currentStats.stats.grossRevenue, 2);
    result.totalWeightedRevenue = Utils.roundToDecimal(currentStats.stats.weightedRevenue, 2);

    const priorStats = await db.getNetworkCardStatsAt(from);

    result.newCards = await db.countCards(to, from);
    result.newNonPromoted = await db.countNonPromotedCards(to, from);
    result.newPromoted = await db.countPromotedCards(to, from);
    result.newAds = await db.countAdCards(to, from);
    result.newPaidOpens = currentStats.stats.paidOpens - priorStats.stats.paidOpens;
    result.newFirstTimePaidOpens = currentStats.stats.firstTimePaidOpens - priorStats.stats.firstTimePaidOpens;
    result.newNormalPaidOpens = currentStats.stats.paidOpens - currentStats.stats.firstTimePaidOpens - (priorStats.stats.paidOpens - priorStats.stats.firstTimePaidOpens);
    result.newFanPaidOpens = currentStats.stats.fanPaidOpens - priorStats.stats.fanPaidOpens;
    result.newGrossRevenue = Utils.roundToDecimal(currentStats.stats.grossRevenue - priorStats.stats.grossRevenue, 2);
    result.newWeightedRevenue = Utils.roundToDecimal(currentStats.stats.weightedRevenue - priorStats.stats.weightedRevenue, 2);
    console.log("Admin.computeCardGoals took " + ((Date.now() - starting) / 1000).toFixed(1) + " seconds");
    return result;
  }

  private async computePublisherRevenueGoals(from: number, to: number): Promise<AdminPublisherRevenueGoalsInfo> {
    const result: AdminPublisherRevenueGoalsInfo = {
      totalCardsOpened: 0,
      totalCardsPurchased: 0,
      totalCardsFullPrice: 0,
      totalCardsDiscounted: 0,
      totalRevenue: "",
      newCardsOpened: 0,
      newCardsPurchased: 0,
      newCardsFullPrice: 0,
      newCardsDiscounted: 0,
      newRevenue: ""
    };
    const starting = Date.now();
    result.totalCardsOpened = await db.countUserCardOpens(to, 0);
    result.totalCardsPurchased = await db.countBankTransactionsByReason("card-open-fee", to, 0);
    result.totalCardsDiscounted = await db.countBankTransactionsByReasonWithAmount("card-open-fee", to, 0, 0.000001);
    result.totalCardsFullPrice = result.totalCardsPurchased - result.totalCardsDiscounted;
    result.totalRevenue = (await db.totalBankTransactionsAmountByReason("card-open-fee", to, 0)).toFixed(2);

    result.newCardsOpened = await db.countUserCardOpens(to, from);
    result.newCardsPurchased = await db.countBankTransactionsByReason("card-open-fee", to, from);
    result.newCardsDiscounted = await db.countBankTransactionsByReasonWithAmount("card-open-fee", to, from, 0.000001);
    result.newCardsFullPrice = result.newCardsPurchased - result.newCardsDiscounted;
    result.newRevenue = (await db.totalBankTransactionsAmountByReason("card-open-fee", to, from)).toFixed(2);
    console.log("Admin.computePublisherRevenueGoals took " + ((Date.now() - starting) / 1000).toFixed(1) + " seconds");
    return result;
  }

  private async computeAdRevenueGoals(from: number, to: number): Promise<AdminAdRevenueGoalsInfo> {
    const result: AdminAdRevenueGoalsInfo = {
      totalImpressions: 0,
      totalPromotedOpens: 0,
      totalPromotedRevenue: "",
      totalAdRevenue: "",
      totalClickRevenue: "",
      newImpressions: 0,
      newPromotedOpens: 0,
      newPromotedRevenue: "",
      newAdRevenue: "",
      newClickRevenue: ""
    };
    const starting = Date.now();
    result.totalImpressions = await db.countBankTransactionsByReason("card-promotion", to, 0);
    result.totalPromotedOpens = await db.countBankTransactionsByReason("card-open-payment", to, 0);
    result.totalPromotedRevenue = (await db.totalBankTransactionsAmountByReason("card-promotion", to, 0)).toFixed(2);
    result.totalAdRevenue = (await db.totalBankTransactionsAmountByReason("card-open-payment", to, 0)).toFixed(2);
    result.totalClickRevenue = (await db.totalBankTransactionsAmountByReason("card-click-payment", to, 0)).toFixed(2);
    result.newImpressions = await db.countBankTransactionsByReason("card-promotion", to, from);
    result.newPromotedOpens = await db.countBankTransactionsByReason("card-open-payment", to, from);
    result.newPromotedRevenue = (await db.totalBankTransactionsAmountByReason("card-promotion", to, from)).toFixed(2);
    result.newAdRevenue = (await db.totalBankTransactionsAmountByReason("card-open-payment", to, from)).toFixed(2);
    result.newClickRevenue = (await db.totalBankTransactionsAmountByReason("card-click-payment", to, from)).toFixed(2);
    console.log("Admin.computeAdRevenueGoals took " + ((Date.now() - starting) / 1000).toFixed(1) + " seconds");
    return result;
  }

  private async handleGetWithdrawals(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetWithdrawalsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      errorManager.error("AdminManager.handleGetWithdrawals: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateWithdrawal(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminUpdateWithdrawalDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      errorManager.error("AdminManager.handleUpdateWithdrawal: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetAdminPublishers(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetPublishersDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      console.log("AdminManager.admin-publishers", user.id, requestBody.detailsObject);
      const reply: AdminGetPublishersResponse = {
        serverVersion: SERVER_VERSION,
        publishers: []
      };
      const cursor = db.getUserPublishers();
      const now = Date.now();
      while (await cursor.hasNext()) {
        const publisherUser = await cursor.next();
        const publisher: AdminPublisherInfo = {
          user: publisherUser,
          cardsPublished: await db.countCardPostsByUser(publisherUser.id, 0, now),
          earnings: await db.aggregateCardRevenueByAuthor(publisherUser.id),
          grossRevenue: 0,
          weightedRevenue: 0,
          subscribers: 0,
          cardsPurchased: 0,
          fraudPurchases: 0,
          firstTimePurchases: 0,
          normalPurchases: 0,
          fanPurchases: 0,
          otherPurchases: 0
        };
        const channels = await db.findChannelsByOwnerId(publisherUser.id);
        const channelIds: string[] = [];
        for (const channel of channels) {
          channelIds.push(channel.id);
        }
        publisher.subscribers = await db.countDistinctSubscribersInChannels(channelIds);
        const payInfoByCategory = await db.aggregateUserActionPaymentsForAuthor(publisherUser.id);
        for (const payInfo of payInfoByCategory) {
          publisher.grossRevenue += payInfo.grossRevenue;
          publisher.weightedRevenue += payInfo.weightedRevenue;
          publisher.cardsPurchased += payInfo.purchases;
          switch (payInfo._id) {
            case "fraud":
              publisher.fraudPurchases += payInfo.purchases;
              break;
            case "normal":
              publisher.normalPurchases += payInfo.purchases;
              break;
            case "first":
              publisher.firstTimePurchases += payInfo.purchases;
              break;
            case "fan":
              publisher.fanPurchases += payInfo.purchases;
              break;
            default:
              publisher.otherPurchases += payInfo.purchases;
              break;
          }
        }
        reply.publishers.push(publisher);
        if (reply.publishers.length >= 250) {
          break;
        }
      }
      await cursor.close();
      response.json(reply);
    } catch (err) {
      errorManager.error("AdminManager.handleGetAdminPublishers: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

}

const adminManager = new AdminManager();

export { adminManager };
