import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from './interfaces/rest-server';
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { SERVER_VERSION } from "./server-version";
import { RestRequest, QueryPageDetails, QueryPageResponse, AdminGetGoalsDetails, AdminGetGoalsResponse, AdminGoalsInfo, AdminUserGoalsInfo, AdminCardGoalsInfo } from "./interfaces/rest-services";
import * as moment from "moment-timezone";
import { db } from "./db";

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
      console.error("ClientServices.handleQueryPage: Failure", err);
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
        active: 0,
        nonViewers: 0,
        oneTimeViewers: 0,
        returnViewers: 0,
        posters: 0
      },
      anonymous: {
        newUsers: 0,
        active: 0,
        bounces: 0,
        nonViewers: 0,
        oneTimeViewers: 0,
        returnViewers: 0
      }
    };
    const cursor = db.getUserCursorByLastContact(from, to);
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      if (user.added > from) {
        result.newUsers++;
      }
      result.active++;
      if (user.identity && user.identity.handle) {
        if (user.added > from) {
          result.withIdentity.newUsers++;
        }
        result.withIdentity.active++;
        const views = await db.countUserCardsPaidInTimeframe(user.id, from, to);
        if (user.lastContact - user.added > 1000 * 60 * 60 * 3 && views > 1) {
          result.withIdentity.returnViewers++;
        } else if (views > 0) {
          result.withIdentity.oneTimeViewers++;
        } else {
          result.withIdentity.nonViewers++;
        }
        const posts = await db.countCardPostsByUser(user.id, from, to);
        if (posts > 0) {
          result.withIdentity.posters++;
        }
      } else {
        if (user.added > from) {
          result.anonymous.newUsers++;
        }
        result.anonymous.active++;
        const views = await db.countUserCardsPaidInTimeframe(user.id, from, to);
        if (user.lastContact - user.added > 1000 * 60 * 60 * 3) {
          if (views > 1) {
            result.anonymous.returnViewers++;
          } else if (views > 0) {
            result.anonymous.oneTimeViewers++;
          } else {
            result.anonymous.nonViewers++;
          }
        } else if (views > 0) {
          result.anonymous.oneTimeViewers++;
        } else {
          result.anonymous.bounces++;
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
        purchases: 0
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
    const cursor = db.getCardCursorByPostedAt(from, to);
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      const firstCardByAuthor = await db.findFirstCardByUser(card.by.id);
      if (card.pricing.openFeeUnits) {
        if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
          result.payFor.firstTimePosts++;
        }
        result.payFor.totalPosts++;
        result.payFor.purchases += await db.countCardPayments(card.id, from, to);
      } else if (card.pricing.promotionFee > 0) {
        if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
          result.promoted.impressionBased.firstTimePosts++;
        }
        result.promoted.impressionBased.totalPosts++;
        result.promoted.impressionBased.totalImpressions += await db.countCardImpressions(card.id, from, to);
        result.promoted.impressionBased.usersWithImpressions += await db.countDistinctUserImpressions(card.id, from, to);
        result.promoted.impressionBased.totalClicks += await db.countCardClicks(card.id, from, to);
        result.promoted.impressionBased.usersWhoClicked += await db.countDistinctUserClicks(card.id, from, to);
      } else {
        if (firstCardByAuthor && firstCardByAuthor.id === card.id) {
          result.promoted.openBased.firstTimePosts++;
        }
        result.promoted.openBased.totalPosts++;
        result.promoted.openBased.totalImpressions += await db.countCardImpressions(card.id, from, to);
        result.promoted.openBased.usersWithImpressions += await db.countDistinctUserImpressions(card.id, from, to);
        result.promoted.openBased.totalPaymentCount += await db.countCardPromotedPayments(card.id, from, to);
        result.promoted.openBased.usersWhoWerePaid += await db.countDistinctUserPromotedPayments(card.id, from, to);
      }
    }
    return result;
  }
}

const adminManager = new AdminManager();

export { adminManager };
