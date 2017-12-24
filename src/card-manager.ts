import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { CardRecord, UserRecord, CardMutationType, CardMutationRecord, CardStateGroup, Mutation, SetPropertyMutation, AddRecordMutation, UpdateRecordMutation, DeleteRecordMutation, MoveRecordMutation, IncrementPropertyMutation, UpdateRecordFieldMutation, IncrementRecordFieldMutation, CardActionType, BankCouponDetails, CardStatistic, CardPromotionScores, NetworkCardStats } from "./interfaces/db-records";
import { db } from "./db";
import { configuration } from "./configuration";
import * as AWS from 'aws-sdk';
import { awsManager, NotificationHandler, ChannelsServerNotification } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { socketServer, CardHandler } from "./socket-server";
import { NotifyCardPostedDetails, NotifyCardMutationDetails, BankTransactionResult } from "./interfaces/socket-messages";
import { CardDescriptor, RestRequest, GetCardDetails, GetCardResponse, PostCardDetails, PostCardResponse, CardImpressionDetails, CardImpressionResponse, CardOpenedDetails, CardOpenedResponse, CardPayDetails, CardPayResponse, CardClosedDetails, CardClosedResponse, UpdateCardLikeDetails, UpdateCardLikeResponse, BankTransactionDetails, CardRedeemOpenDetails, CardRedeemOpenResponse, UpdateCardPrivateDetails, DeleteCardDetails, DeleteCardResponse, CardStatsHistoryDetails, CardStatsHistoryResponse, CardStatDatapoint, UpdateCardPrivateResponse, UpdateCardStateDetails, UpdateCardStateResponse, CardState, UpdateCardPricingDetails, UpdateCardPricingResponse, CardPricingInfo, BankTransactionRecipientDirective, AdminUpdateCardDetails, AdminUpdateCardResponse } from "./interfaces/rest-services";
import { priceRegulator } from "./price-regulator";
import { RestServer } from "./interfaces/rest-server";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { KeyUtils } from "./key-utils";
import { bank } from "./bank";
import { userManager } from "./user-manager";
import { SignedObject } from "./interfaces/signed-object";
import * as uuid from "uuid";
import { networkEntity } from "./network-entity";
import { channelsComponentManager } from "./channels-component-manager";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
import { emailManager } from "./email-manager";
import { SERVER_VERSION } from "./server-version";
import * as LRU from 'lru-cache';
import * as url from 'url';
import { Utils } from "./utils";
import { rootPageManager } from "./root-page-manager";
import { fileManager } from "./file-manager";
import { feedManager } from "./feed-manager";

const promiseLimit = require('promise-limit');

const CARD_LOCK_TIMEOUT = 1000 * 60;
const DEFAULT_STAT_SNAPSHOT_INTERVAL = 1000 * 60 * 15;
const REVENUE_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const IMPRESSIONS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const UNIQUE_IMPRESSIONS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const PROMOTIONS_PAID_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const OPENS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const UNIQUE_OPENS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const OPEN_FEES_PAID_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const LIKE_DISLIKE_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const DEFAULT_CARD_PAYMENT_DELAY = 1000 * 10;
const CARD_PAYMENT_DELAY_PER_LEVEL = 1000 * 5;
const MINIMUM_USER_FRAUD_AGE = 1000 * 60 * 15;
const REPEAT_CARD_PAYMENT_DELAY = 1000 * 15;
const PUBLISHER_SUBSIDY_RETURN_VIEWER_MULTIPLIER = 2;
const PUBLISHER_SUBSIDY_MAX_CARD_AGE = 1000 * 60 * 60 * 24;

const MAX_SEARCH_STRING_LENGTH = 2000000;

export class CardManager implements Initializable, NotificationHandler, CardHandler, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private lastMutationIndexSent = 0;
  private mutationSemaphore = promiseLimit(1) as (p: Promise<void>) => Promise<void>;
  private userCache = LRU<string, UserRecord>({ max: 10000, maxAge: 1000 * 60 * 5 });

  async initialize(): Promise<void> {
    awsManager.registerNotificationHandler(this);
    // To handle migration to new scoring scheme, we need to populate the latest stats
    const networkCardStats = await db.findLatestNetworkCardStats();
    if (!networkCardStats) {
      const stats = db.createEmptyNetworkCardStats();
      const cards = await db.findCardsByTime(100);
      for (const card of cards) {
        stats.opens += card.stats.opens ? card.stats.opens.value : 0;
        stats.uniqueOpens += card.stats.uniqueOpens ? card.stats.uniqueOpens.value : 0;
        stats.paidOpens += card.stats.uniqueOpens ? card.stats.uniqueOpens.value : 0;
        stats.likes += card.stats.likes ? card.stats.likes.value : 0;
        stats.dislikes += card.stats.dislikes ? card.stats.dislikes.value : 0;
        stats.cardRevenue += card.stats.revenue ? card.stats.revenue.value : 0;
      }
      await db.insertOriginalNetworkCardStats(stats);
    }
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.get('/c/:cardId', (request: Request, response: Response) => {
      void this.handleCardRequest(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-card'), (request: Request, response: Response) => {
      void this.handleGetCard(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('post-card'), (request: Request, response: Response) => {
      void this.handlePostCard(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-impression'), (request: Request, response: Response) => {
      void this.handleCardImpression(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-opened'), (request: Request, response: Response) => {
      void this.handleCardOpened(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-pay'), (request: Request, response: Response) => {
      void this.handleCardPay(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-redeem-open'), (request: Request, response: Response) => {
      void this.handleRedeemCardOpen(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-closed'), (request: Request, response: Response) => {
      void this.handleCardClosed(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-card-like'), (request: Request, response: Response) => {
      void this.handleUpdateCardLike(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-card-private'), (request: Request, response: Response) => {
      void this.handleUpdateCardPrivate(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('delete-card'), (request: Request, response: Response) => {
      void this.handleDeleteCard(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-stat-history'), (request: Request, response: Response) => {
      void this.handleCardStatHistory(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-state-update'), (request: Request, response: Response) => {
      void this.handleCardStateUpdate(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('card-pricing-update'), (request: Request, response: Response) => {
      void this.handleCardPricingUpdate(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-update-card'), (request: Request, response: Response) => {
      void this.handleAdminUpdateCard(request, response);
    });
  }

  async initialize2(): Promise<void> {
    const lastMutation = await db.findLastMutationByIndex();
    if (lastMutation) {
      this.lastMutationIndexSent = lastMutation.index;
    }
  }

  private async handleCardRequest(request: Request, response: Response): Promise<void> {
    console.log("handleCardRequest!!");
    const card = await db.findCardById(request.params.cardId, false, true);
    if (!card) {
      response.redirect('/');
      return;
    }
    await rootPageManager.handlePage("card", request, response, card);
  }

  private async handleGetCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.get-card", requestBody.detailsObject);
      const cardState = await this.populateCardState(card.id, true, false, user);
      if (!cardState) {
        response.status(404).send("Missing card state");
        return;
      }
      let delay = DEFAULT_CARD_PAYMENT_DELAY;
      if (cardState.pricing.openFeeUnits > 1) {
        delay += (cardState.pricing.openFeeUnits - 1) * CARD_PAYMENT_DELAY_PER_LEVEL;
      }
      const now = Date.now();
      if (user.ipAddresses.length > 0 && now - user.added < MINIMUM_USER_FRAUD_AGE) {
        const otherUsers = await db.findUsersByIpAddress(user.ipAddresses[user.ipAddresses.length - 1]);
        // Here, we're seeing if this is a new user and there have been a lot of other new users from the same
        // IP address recently, in which case, this may be someone using incognito windows to fraudulently
        // purchase cards.  So we slow down payment based on how recently other users from the same IP
        // address were registered
        for (const otherUser of otherUsers) {
          if (otherUser.id === user.id) {
            continue;
          }
          if (now - otherUser.added > MINIMUM_USER_FRAUD_AGE) {
            break;
          }
          delay += REPEAT_CARD_PAYMENT_DELAY * (MINIMUM_USER_FRAUD_AGE - (now - otherUser.added)) / MINIMUM_USER_FRAUD_AGE;
          console.warn("Card.handleGetCard: imposing extra delay penalty", delay);
        }
      }
      const reply: GetCardResponse = {
        serverVersion: SERVER_VERSION,
        card: cardState,
        paymentDelayMsecs: delay
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetCard: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handlePostCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<PostCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("CardManager.post-card", requestBody.detailsObject);
      // if (!requestBody.detailsObject.text) {
      //   response.status(400).send("Invalid request: missing text");
      //   return;
      // }
      const details = requestBody.detailsObject;
      const card = await this.postCard(user, requestBody.detailsObject, requestBody.detailsObject.address);
      const reply: PostCardResponse = {
        serverVersion: SERVER_VERSION,
        cardId: card.id
      };
      if (requestBody.detailsObject.sharedState) {
        await this.insertCardSharedState(card, requestBody.detailsObject.sharedState);
      }
      response.json(reply);
    } catch (err) {
      console.error("User.handlePostCard: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  searchTextFromSharedState(sharedState: CardState): string {
    let result = this.getObjectStringRecursive(sharedState);
    if (result.length > MAX_SEARCH_STRING_LENGTH) {
      result = result.substr(0, MAX_SEARCH_STRING_LENGTH);
    }
    return result;
  }

  private getObjectStringRecursive(object: any): string {
    let result = "";
    if (typeof object === 'string') {
      result = object;
    } else if (Array.isArray(object)) {
      for (const item of object) {
        result += this.getObjectStringRecursive(item) + " ";
      }
    } else if (typeof object === 'object') {
      for (const key of Object.keys(object)) {
        result += this.getObjectStringRecursive(object[key]) + " ";
      }
    }
    return result.trim();
  }

  private async insertCardSharedState(card: CardRecord, state: CardState): Promise<void> {
    if (state.properties) {
      for (const key of Object.keys(state.properties)) {
        await db.upsertCardProperty(card.id, "shared", '', key, state.properties[key]);
      }
    }
    if (state.collections) {
      for (const key of Object.keys(state.collections)) {
        const collection = state.collections[key];
        await db.insertCardCollection(card.id, 'shared', '', key, collection.keyField);
        let index = 0;
        for (const record of collection.records) {
          await db.insertCardCollectionItem(card.id, "shared", '', key, collection.keyField ? record[collection.keyField] : index.toString(), index, record);
          index++;
        }
      }
    }
  }

  private async handleCardImpression(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardImpressionDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      let author: UserRecord;
      if (!card) {
        return;
      }
      let transaction: BankTransactionDetails;
      if (requestBody.detailsObject.transaction) {
        if (card.pricing.promotionFee <= 0) {
          response.status(400).send("No promotion fee paid on this card");
          return;
        }
        const info = await db.ensureUserCardInfo(user.id, card.id);
        if (card.pricing.openPayment > 0 && info.earnedFromAuthor > 0) {
          response.status(400).send("You have already been paid a promotion on this card");
          return;
        }
        author = await this.getUser(card.by.id, true);
        if (!author) {
          response.status(404).send("The author no longer has an account.");
          return;
        }
        if (!author.admin && author.balance < card.pricing.promotionFee) {
          response.status(402).send("The author does not have sufficient funds.");
          return;
        }
        transaction = JSON.parse(requestBody.detailsObject.transaction.objectString) as BankTransactionDetails;
        if (transaction.address !== card.by.address) {
          response.status(400).send("The transaction doesn't list the card author as the source.");
          return;
        }
        if (transaction.amount !== card.pricing.promotionFee) {
          response.status(400).send("Transaction amount does not match card promotion fee.");
          return;
        }
        if (transaction.reason !== "card-promotion") {
          response.status(400).send("Transaction reason must be card-promotion.");
          return;
        }
        if (transaction.relatedCardId !== card.id) {
          response.status(400).send("Transaction refers to the wrong card");
          return;
        }
        if (card.couponIds.indexOf(transaction.relatedCouponId) < 0) {
          response.status(400).send("Transaction refers to the wrong coupon");
          return;
        }
        if (transaction.type !== "coupon-redemption") {
          response.status(400).send("Transaction type must be coupon-redemption");
          return;
        }
        if (!transaction.toRecipients || transaction.toRecipients.length !== 1) {
          response.status(400).send("Transaction recipients are incorrect.");
          return;
        }
        if (transaction.toRecipients[0].address !== user.address || transaction.toRecipients[0].portion !== 'remainder' || transaction.toRecipients[0].reason !== "coupon-redemption") {
          response.status(400).send("Transaction recipient is incorrect.");
          return;
        }
        const coupon = await db.findBankCouponById(transaction.relatedCouponId);
        if (coupon.cardId !== card.id) {
          response.status(400).send("Invalid coupon: card mismatch");
          return;
        }
        if (author.address !== coupon.byAddress) {
          response.status(400).send("Invalid coupon: author mismatch");
          return;
        }
        if (coupon.amount !== card.pricing.promotionFee) {
          response.status(400).send("Invalid coupon: promotion fee mismatch: " + coupon.amount + " vs " + card.pricing.promotionFee);
          return;
        }
        if (coupon.reason !== 'card-promotion') {
          response.status(400).send("Invalid coupon: invalid type");
          return;
        }
      }
      console.log("CardManager.card-impression", requestBody.detailsObject);
      const now = Date.now();
      const userCard = await db.findUserCardInfo(user.id, card.id);
      if (!userCard || !userCard.lastImpression) {
        await this.incrementStat(card, "uniqueImpressions", 1, now, UNIQUE_IMPRESSIONS_SNAPSHOT_INTERVAL);
      }
      await this.incrementStat(card, "impressions", 1, now, IMPRESSIONS_SNAPSHOT_INTERVAL);
      await db.insertUserCardAction(user.id, card.id, now, "impression", 0, null, 0, null, 0, null);
      await db.updateUserCardLastImpression(user.id, card.id, now);
      let transactionResult: BankTransactionResult;
      if (transaction && author) {
        await userManager.updateUserBalance(user);
        await userManager.updateUserBalance(author);
        transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.transaction);
        await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        const budgetAvailable = author.admin || card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent + transactionResult.record.details.amount;
        card.budget.available = budgetAvailable;
        await db.updateCardBudgetUsage(card, transactionResult.record.details.amount, budgetAvailable, this.getPromotionScores(card));
        await db.insertUserCardAction(user.id, card.id, now, "redeem-promotion", 0, null, transactionResult.record.details.amount, transactionResult.record.id, 0, null);
        await this.incrementStat(card, "promotionsPaid", transactionResult.record.details.amount, now, PROMOTIONS_PAID_SNAPSHOT_INTERVAL);
      }
      const userStatus = await userManager.getUserStatus(user, false);
      const reply: CardImpressionResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult ? transactionResult.record.id : null,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardImpression: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUser(userId: string, force: boolean): Promise<UserRecord> {
    let result = this.userCache.get(userId);
    if (result && !force) {
      return result;
    }
    result = await db.findUserById(userId);
    if (result) {
      this.userCache.set(userId, result);
    }
    return result;
  }

  private async handleCardOpened(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardOpenedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.card-opened", requestBody.detailsObject);
      const now = Date.now();
      const userCard = await db.findUserCardInfo(user.id, card.id);
      let uniques = 0;
      if (!userCard || !userCard.lastOpened) {
        await this.incrementStat(card, "uniqueOpens", 1, now, UNIQUE_OPENS_SNAPSHOT_INTERVAL);
        uniques = 1;
      }
      await this.incrementStat(card, "opens", 1, now, OPENS_SNAPSHOT_INTERVAL);
      await db.incrementNetworkCardStatItems(1, uniques, 0, 0, 0);
      await db.insertUserCardAction(user.id, card.id, now, "open", 0, null, 0, null, 0, null);
      await db.updateUserCardLastOpened(user.id, card.id, now);
      const reply: CardOpenedResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardOpened: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardPay(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardPayDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const transaction = JSON.parse(requestBody.detailsObject.transaction.objectString) as BankTransactionDetails;
      if (user.address !== transaction.address) {
        response.status(403).send("You do not own the address in the transaction");
        return;
      }
      if (transaction.type !== "transfer" || transaction.reason !== "card-open-fee") {
        response.status(400).send("The transaction must be 'transfer' with reason 'card-open-fee'");
        return;
      }
      const card = await this.getRequestedCard(user, transaction.relatedCardId, response);
      if (!card) {
        return;
      }
      if (transaction.relatedCouponId) {
        response.status(400).send("No coupon is allowed on the transaction");
        return;
      }
      const author = await db.findUserById(card.by.id);
      if (!author) {
        response.status(404).send("The author of this card is missing");
        return;
      }
      let authorRecipient = false;
      for (const recipient of transaction.toRecipients) {
        let recipientUser = await db.findUserByAddress(recipient.address);
        if (!recipientUser) {
          recipientUser = await db.findUserByHistoricalAddress(recipient.address);
        }
        if (recipientUser) {
          if (recipientUser.id === card.by.id && recipient.portion === 'remainder') {
            authorRecipient = true;
          }
          await userManager.updateUserBalance(recipientUser);
        } else {
          response.status(404).send("One of the recipients is missing");
        }
      }
      if (!authorRecipient) {
        response.status(400).send("The card's author is missing as a recipient with 'remainder'.");
        return;
      }
      console.log("CardManager.card-pay", requestBody.detailsObject, user.balance, transaction.amount);
      await userManager.updateUserBalance(user);
      const transactionResult = await bank.performTransfer(user, requestBody.detailsObject.address, requestBody.detailsObject.transaction, card.summary.title, false, false, true);
      await db.updateUserCardIncrementPaidToAuthor(user.id, card.id, transaction.amount, transactionResult.record.id);
      await db.updateUserCardIncrementEarnedFromReader(card.by.id, card.id, transaction.amount, transactionResult.record.id);
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "pay", 0, null, 0, null, 0, null);
      await this.incrementStat(card, "revenue", transaction.amount, now, REVENUE_SNAPSHOT_INTERVAL);
      await db.incrementNetworkCardStatItems(0, 0, 1, 0, 0);
      const newBudgetAvailable = author.admin || (card.budget && card.budget.amount > 0 && card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent);
      if (card.budget && card.budget.available !== newBudgetAvailable) {
        card.budget.available = newBudgetAvailable;
        await db.updateCardBudgetAvailable(card, newBudgetAvailable, this.getPromotionScores(card));
      }

      const publisherSubsidy = await this.payPublisherSubsidy(user, author, card, transaction.amount, now);
      await db.incrementNetworkTotals(transactionResult.amountByRecipientReason["content-purchase"] + publisherSubsidy, transactionResult.amountByRecipientReason["card-developer-royalty"], 0, 0, publisherSubsidy);
      const userStatus = await userManager.getUserStatus(user, false);
      await feedManager.rescoreCard(card, false);
      const reply: CardPayResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        totalCardRevenue: card.stats.revenue.value,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardPay: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async payPublisherSubsidy(user: UserRecord, author: UserRecord, card: CardRecord, cardPayment: number, now: number): Promise<number> {
    const subsidyDay = await networkEntity.getPublisherSubsidies();
    if (!subsidyDay || subsidyDay.remainingToday <= 0) {
      return 0;
    }
    const cardsBought = await db.countUserCardsPaid(user.id);
    const amount = cardsBought <= 1 && Date.now() - card.postedAt < PUBLISHER_SUBSIDY_MAX_CARD_AGE ? subsidyDay.newUserBonus : subsidyDay.returnUserBonus;
    await db.incrementLatestPublisherSubsidyPaid(subsidyDay.dayStarting, amount);
    const recipient: BankTransactionRecipientDirective = {
      address: author.address,
      portion: "remainder",
      reason: "publisher-subsidy-recipient"
    };
    const details: BankTransactionDetails = {
      address: null,
      timestamp: null,
      type: "transfer",
      reason: "publisher-subsidy",
      relatedCardId: card.id,
      relatedCouponId: null,
      amount: amount,
      toRecipients: [recipient]
    };
    const transactionResult = await networkEntity.performBankTransaction(details, card.summary.title, false, true);
    await this.incrementStat(card, "revenue", amount, now, REVENUE_SNAPSHOT_INTERVAL);
    const newBudgetAvailable = author.admin || (card.budget && card.budget.amount > 0 && card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent);
    if (card.budget && card.budget.available !== newBudgetAvailable) {
      card.budget.available = newBudgetAvailable;
      await db.updateCardBudgetAvailable(card, newBudgetAvailable, this.getPromotionScores(card));
    }
    return amount;
  }

  private async handleRedeemCardOpen(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardRedeemOpenDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.pricing.openPayment <= 0) {
        response.status(400).send("No open payment on this card");
        return;
      }
      const info = await db.ensureUserCardInfo(user.id, card.id);
      if (info.earnedFromAuthor > 0) {
        response.status(400).send("You have already been paid a promotion on this card");
        return;
      }
      const author = await this.getUser(card.by.id, true);
      if (!author) {
        response.status(404).send("The author no longer has an account.");
        return;
      }
      if (!author.admin && author.balance < card.pricing.openPayment) {
        response.status(402).send("The author does not have sufficient funds.");
        return;
      }
      if (!requestBody.detailsObject.transaction) {
        response.status(400).send("Transaction missing");
        return;
      }
      const transaction = JSON.parse(requestBody.detailsObject.transaction.objectString) as BankTransactionDetails;
      if (transaction.address !== card.by.address) {
        response.status(400).send("The transaction doesn't list the card author as the source.");
        return;
      }
      if (transaction.amount !== card.pricing.openPayment) {
        response.status(400).send("Transaction amount does not match card open payment.");
        return;
      }
      if (transaction.reason !== "card-open-payment") {
        response.status(400).send("Transaction reason must be card-open-payment.");
        return;
      }
      if (transaction.relatedCardId !== card.id) {
        response.status(400).send("Transaction refers to the wrong card");
        return;
      }
      if (card.couponIds.indexOf(transaction.relatedCouponId) < 0) {
        response.status(400).send("Transaction refers to the wrong coupon");
        return;
      }
      if (transaction.type !== "coupon-redemption") {
        response.status(400).send("Transaction type must be coupon-redemption");
        return;
      }
      if (!transaction.toRecipients || transaction.toRecipients.length !== 1) {
        response.status(400).send("Transaction recipients are incorrect.");
        return;
      }
      if (transaction.toRecipients[0].address !== user.address || transaction.toRecipients[0].portion !== 'remainder' || transaction.toRecipients[0].reason !== "coupon-redemption") {
        response.status(400).send("Transaction recipient is incorrect.");
        return;
      }
      const coupon = await db.findBankCouponById(transaction.relatedCouponId);
      if (coupon.cardId !== card.id) {
        response.status(400).send("Invalid coupon: card mismatch");
        return;
      }
      if (author.address !== coupon.byAddress) {
        response.status(400).send("Invalid coupon: author mismatch");
        return;
      }
      if (coupon.amount !== card.pricing.openPayment) {
        response.status(400).send("Invalid coupon: open payment mismatch: " + coupon.amount + " vs " + card.pricing.openPayment);
        return;
      }
      if (!author.admin && author.balance < card.pricing.openPayment) {
        response.status(402).send("The author does not have sufficient funds.");
        return;
      }
      if (coupon.reason !== 'card-open-payment') {
        response.status(400).send("Invalid coupon: invalid type");
        return;
      }
      console.log("CardManager.card-redeem-open-payment", requestBody.detailsObject);
      await userManager.updateUserBalance(user);
      await userManager.updateUserBalance(author);
      const transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.transaction);
      await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      const budgetAvailable = author.admin || card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent + transactionResult.record.details.amount;
      card.budget.available = budgetAvailable;
      await db.updateCardBudgetUsage(card, transactionResult.record.details.amount, budgetAvailable, this.getPromotionScores(card));
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "redeem-open-payment", 0, null, 0, null, coupon.amount, transactionResult.record.id);
      await this.incrementStat(card, "openFeesPaid", coupon.amount, now, OPEN_FEES_PAID_SNAPSHOT_INTERVAL);
      const userStatus = await userManager.getUserStatus(user, false);
      const reply: CardRedeemOpenResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleRedeemCardOpen: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardClosed(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardClosedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.card-closed", requestBody.detailsObject);

      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "close", 0, null, 0, null, 0, null);
      await db.updateUserCardLastClosed(user.id, card.id, now);
      const reply: CardClosedResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardClosed: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateCardLike(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardLikeDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.update-card-like", requestBody.detailsObject);
      const cardInfo = await db.ensureUserCardInfo(user.id, card.id);
      if (cardInfo && cardInfo.like !== requestBody.detailsObject.selection) {
        if (cardInfo.like !== requestBody.detailsObject.selection) {
          const now = Date.now();
          let existingLikes = 0;
          let existingDislikes = 0;
          let action: CardActionType;
          switch (cardInfo.like) {
            case "like":
              existingLikes++;
              action = "like";
              break;
            case "dislike":
              existingDislikes++;
              action = "dislike";
              break;
            case "none":
              action = "reset-like";
              break;
            default:
              throw new Error("Unhandled card info like state " + cardInfo.like);
          }
          await db.updateUserCardInfoLikeState(user.id, card.id, requestBody.detailsObject.selection);
          cardInfo.like = requestBody.detailsObject.selection;
          await db.insertUserCardAction(user.id, card.id, now, action, 0, null, 0, null, 0, null);
          let newLikes = 0;
          let newDislikes = 0;
          switch (requestBody.detailsObject.selection) {
            case "like":
              newLikes++;
              break;
            case "dislike":
              newDislikes++;
              break;
            case "none":
              break;
            default:
              throw new Error("Unhandled card info like state " + cardInfo.like);
          }
          const deltaLikes = newLikes - existingLikes;
          const deltaDislikes = newDislikes - existingDislikes;
          if (deltaLikes !== 0) {
            await this.incrementStat(card, "likes", deltaLikes, now, LIKE_DISLIKE_SNAPSHOT_INTERVAL);
            await db.incrementNetworkCardStatItems(0, 0, 0, deltaLikes, 0);
          }
          if (deltaDislikes !== 0) {
            await this.incrementStat(card, "dislikes", deltaDislikes, now, LIKE_DISLIKE_SNAPSHOT_INTERVAL);
            await db.incrementNetworkCardStatItems(0, 0, 0, 0, deltaDislikes);
          }
          await feedManager.rescoreCard(card, false);
        }
      }
      const reply: UpdateCardLikeResponse = {
        serverVersion: SERVER_VERSION,
        newValue: cardInfo.like
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateCardLike: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateCardPrivate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardPrivateDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.by.id !== user.id) {
        response.status(403).send("Only the author is allowed to make this change.");
        return;
      }
      console.log("CardManager.update-card-private", requestBody.detailsObject);
      const cardInfo = await db.ensureUserCardInfo(user.id, card.id);
      if (card.private !== requestBody.detailsObject.private) {
        await db.updateCardPrivate(card, requestBody.detailsObject.private);
        await db.insertUserCardAction(user.id, card.id, Date.now(), requestBody.detailsObject.private ? "make-private" : "make-public", 0, null, 0, null, 0, null);
      }
      const reply: UpdateCardPrivateResponse = {
        serverVersion: SERVER_VERSION,
        newValue: requestBody.detailsObject.private
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateCardPrivate: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleDeleteCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<DeleteCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.by.id !== user.id) {
        response.status(403).send("Only the author is allowed to delete a card.");
        return;
      }
      console.log("CardManager.delete-card", requestBody.detailsObject);
      await db.updateCardState(card, "deleted");
      const reply: DeleteCardResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleDeleteCard: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardStatHistory(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardStatsHistoryDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.card-stat-history", requestBody.detailsObject);
      const reply: CardStatsHistoryResponse = {
        serverVersion: SERVER_VERSION,
        revenue: [],
        promotionsPaid: [],
        openFeesPaid: [],
        impressions: [],
        uniqueImpressions: [],
        opens: [],
        uniqueOpens: [],
        likes: [],
        dislikes: []
      };
      for (const key of Object.keys(reply)) {
        const items = await db.findCardStatsHistory(card.id, key, requestBody.detailsObject.historyLimit);
        for (const item of items) {
          const d: CardStatDatapoint = {
            value: item.value,
            at: item.at
          };
          (reply as any)[key].push(d);
        }
      }
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardStatHistory: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleCardStateUpdate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardStateDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.cardId || (!requestBody.detailsObject.state && !requestBody.detailsObject.summary)) {
        response.status(400).send("You must update state and/or summary.");
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.by.id !== user.id) {
        response.status(401).send("Only the card author can edit it.");
        return;
      }
      console.log("CardManager.card-state-update", requestBody.detailsObject);
      let keywords: string[];
      if (requestBody.detailsObject.keywords && requestBody.detailsObject.keywords.length > 0) {
        keywords = [];
        for (const k of requestBody.detailsObject.keywords) {
          keywords.push(k.trim().toLowerCase());
        }
      }
      if (requestBody.detailsObject.summary || keywords) {
        const summary = requestBody.detailsObject.summary;
        await db.updateCardSummary(card, summary.title, summary.text, summary.linkUrl, summary.imageUrl, summary.imageWidth, summary.imageHeight, keywords);
      }
      if (requestBody.detailsObject.state) {
        await db.deleteCardProperties(card.id);
        await db.deleteCardCollections(card.id);
        await db.deleteCardCollectionItems(card.id);
        await this.insertCardSharedState(card, requestBody.detailsObject.state);
      }
      const reply: UpdateCardStateResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardStateUpdate: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleCardPricingUpdate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardPricingDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.cardId) {
        response.status(400).send("Missing cardId");
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.by.id !== user.id) {
        response.status(401).send("Only the card author can edit it.");
        return;
      }
      const pricing = requestBody.detailsObject.pricing;
      this.validateCardPricing(user, pricing);
      console.log("CardManager.card-pricing-update", requestBody.detailsObject);
      pricing.promotionFee = pricing.promotionFee || 0;
      pricing.openPayment = pricing.openPayment || 0;
      pricing.openFeeUnits = pricing.openFeeUnits || 0;
      let totalBudget = 0;
      let budgetAvailable = false;
      if (pricing.budget) {
        totalBudget = card.budget.spent + pricing.budget.amount;
        pricing.budget.plusPercent = pricing.budget.plusPercent || 0;
        budgetAvailable = user.admin || totalBudget > user.balance;
      }
      let couponId: string;
      if (pricing.coupon) {
        const couponRecord = await bank.registerCoupon(user, card.id, pricing.coupon);
        couponId = couponRecord.id;
      }
      await db.updateCardPricing(card, pricing.promotionFee, pricing.openPayment, pricing.openFeeUnits, couponId, pricing.coupon, totalBudget, pricing.budget.plusPercent, budgetAvailable);
      const reply: UpdateCardPricingResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardStateUpdate: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleAdminUpdateCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminUpdateCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You must be an admin");
        return;
      }
      if (!requestBody.detailsObject.cardId) {
        response.status(400).send("Missing cardId");
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.admin-update-card", requestBody.detailsObject);
      await db.updateCardAdmin(card, requestBody.detailsObject.keywords, requestBody.detailsObject.blocked, requestBody.detailsObject.boost);
      const reply: AdminUpdateCardResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleAdminUpdateCard: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getRequestedCard(user: UserRecord, cardId: string, response: Response): Promise<CardRecord> {
    const card = await db.findCardById(cardId, false);
    if (!card) {
      response.status(404).send("This card is no longer available");
      return null;
    }
    return card;
  }

  async postCard(user: UserRecord, details: PostCardDetails, byAddress: string): Promise<CardRecord> {
    // if (!details.text) {
    //   throw new ErrorWithStatusCode(400, "Invalid card: missing text");
    // }
    if (!details.cardType && !details.linkUrl) {
      throw new ErrorWithStatusCode(400, "You must provide a card type or a linkUrl");
    }
    if (details.imageUrl && (details.imageHeight <= 0 || details.imageWidth <= 0)) {
      throw new ErrorWithStatusCode(400, "You must provide image width and height");
    }
    this.validateCardPricing(user, details.pricing);
    details.private = details.private ? true : false;
    const componentResponse = await channelsComponentManager.ensureComponent(details.cardType);
    let couponId: string;
    const cardId = uuid.v4();
    if (details.pricing.coupon) {
      const couponRecord = await bank.registerCoupon(user, cardId, details.pricing.coupon);
      couponId = couponRecord.id;
    }
    const promotionScores = this.getPromotionScoresFromData(details.pricing.budget && details.pricing.budget.amount > 0, details.pricing.openFeeUnits, details.pricing.promotionFee, details.pricing.openPayment, 0, 0);
    const keywords: string[] = [];
    if (details.keywords) {
      for (const keyword of details.keywords) {
        keywords.push(keyword.trim().toLowerCase());
      }
    }
    const searchText = details.searchText && details.searchText.length > 0 ? details.searchText : this.searchTextFromSharedState(details.sharedState);
    const card = await db.insertCard(user.id, byAddress, user.identity.handle, user.identity.name, user.identity.imageUrl, details.imageUrl, details.imageWidth, details.imageHeight, details.linkUrl, details.title, details.text, details.private, details.cardType, componentResponse.channelComponent.iconUrl, componentResponse.channelComponent.developerAddress, componentResponse.channelComponent.developerFraction, details.pricing.promotionFee, details.pricing.openPayment, details.pricing.openFeeUnits, details.pricing.budget ? details.pricing.budget.amount : 0, couponId ? true : false, details.pricing.budget ? details.pricing.budget.plusPercent : 0, details.pricing.coupon, couponId, keywords, searchText, details.fileIds, promotionScores, cardId);
    await this.announceCard(card, user);
    await fileManager.finalizeFiles(user, card.fileIds);
    if (configuration.get("notifications.postCard")) {
      let html = "<div>";
      html += "<div>User: " + user.identity.name + "</div>";
      html += "<div>Handle: " + user.identity.handle + "</div>";
      html += "<div>Title: " + details.title + "</div>";
      html += "<div>Text: " + details.text + "</div>";
      html += "<div>CardType: " + details.cardType + "</div>";
      html += "<div>Private: " + details.private + "</div>";
      if (details.pricing.promotionFee) {
        html += "<div>Promotion fee: " + details.pricing.promotionFee + "</div>";
      }
      if (details.pricing.openFeeUnits) {
        html += "<div>Open fee (units): " + details.pricing.openFeeUnits + "</div>";
      }
      if (details.pricing.openPayment) {
        html += "<div>Open payment: " + details.pricing.openPayment + "</div>";
      }
      html += "</div>";
      void emailManager.sendInternalNotification("Card posted", "", html);
    }
    await db.updateUserLastPosted(user.id, card.postedAt);
    return card;
  }

  private validateCardPricing(user: UserRecord, pricing: CardPricingInfo): void {
    if (!pricing) {
      throw new ErrorWithStatusCode(400, "You must provide pricing information");
    }
    pricing.promotionFee = pricing.promotionFee || 0;
    pricing.openFeeUnits = pricing.openFeeUnits || 0;
    pricing.openPayment = pricing.openPayment || 0;
    if (pricing.openPayment > 0 || pricing.promotionFee > 0) {
      pricing.budget = pricing.budget || { amount: 0, plusPercent: 0 };
      // if (!pricing.budget) {
      //   throw new ErrorWithStatusCode(400, "You must provide a budget if you offer payment.");
      // }
      pricing.budget.amount = Math.max(pricing.budget.amount || 0, 0);
      pricing.budget.plusPercent = Math.max(pricing.budget.plusPercent || 0, 0);
      if (pricing.budget.amount < 0) {
        throw new ErrorWithStatusCode(400, "Minimum budget is 0.");
      }
      if (!user.admin && pricing.budget.amount > 0 && pricing.budget.amount > user.balance - 1) {
        throw new ErrorWithStatusCode(400, "Budget exceeds your balance, leaving at least ℂ1 to spare.");
      }
      if (pricing.budget.plusPercent < 0 || pricing.budget.plusPercent > 90) {
        throw new ErrorWithStatusCode(400, "Budget plusPercent must be between 0 and 90.");
      }
    }
    if (pricing.promotionFee < 0 || pricing.openPayment < 0) {
      throw new ErrorWithStatusCode(400, "Promotion fee and openPayment must be greater than or equal to zero.");
    }
    if (pricing.openPayment > 0 && pricing.promotionFee > 0) {
      throw new ErrorWithStatusCode(400, "You can't declare both an openPayment and a promotionFee.");
    }
    pricing.openFeeUnits = Math.round(pricing.openFeeUnits);
    if (pricing.promotionFee === 0 && pricing.openPayment === 0 && pricing.openFeeUnits === 0) {
      throw new ErrorWithStatusCode(400, "Not all of promotionFee, openPayment and openFeeUnits can be zero.");
    }
    if (pricing.openPayment > 0 && pricing.openFeeUnits > 0) {
      throw new ErrorWithStatusCode(400, "openPayment and openFeeUnits cannot both be non-zero.");
    }
    if (pricing.openPayment === 0 && (pricing.openFeeUnits < 0 || pricing.openFeeUnits > 10)) {
      throw new ErrorWithStatusCode(400, "OpenFeeUnits must be between 1 and 10.");
    }
    if (pricing.promotionFee > 0 || pricing.openPayment > 0) {
      if (!pricing.coupon) {
        throw new ErrorWithStatusCode(400, "If you offer payment, you must include a coupon");
      }
    }
  }

  async lockCard(cardId: string): Promise<CardRecord> {
    return await db.lockCard(cardId, CARD_LOCK_TIMEOUT, configuration.get('serverId'));
  }

  async unlockCard(card: CardRecord): Promise<void> {
    await db.unlockCard(card);
  }

  async mutateCard(user: UserRecord, cardId: string, mutation: Mutation): Promise<CardMutationRecord> {
    let card: CardRecord;
    try {
      card = await this.lockCard(cardId);
      if (!card) {
        return null;
      }
      switch (mutation.type) {
        case "set-property": {
          const pMutation = mutation as SetPropertyMutation;
          if (pMutation.value === 'null') {
            await db.deleteCardProperty(cardId, pMutation.group, pMutation.group === 'user' ? user.id : '', pMutation.name);
          } else {
            await db.upsertCardProperty(cardId, pMutation.group, pMutation.group === 'user' ? user.id : '', pMutation.name, pMutation.value);
          }
          break;
        }
        case "inc-property": {
          const ipMutation = mutation as IncrementPropertyMutation;
          const property = await db.findCardProperty(cardId, ipMutation.group, ipMutation.group === 'user' ? user.id : '', ipMutation.name);
          let value = 0;
          if (property) {
            if (typeof property.value === 'number') {
              value = property.value;
            }
          }
          value += ipMutation.incrementBy;
          await db.upsertCardProperty(cardId, ipMutation.group, ipMutation.group === 'user' ? user.id : '', ipMutation.name, value);
          break;
        }
        case "add-record": {
          const arMutation = mutation as AddRecordMutation;
          let newIndex: number;
          if (arMutation.beforeKey) {
            const before = await db.findCardCollectionItemRecord(card.id, arMutation.group, user.id, arMutation.collectionName, arMutation.beforeKey);
            if (before) {
              const prior = await db.findFirstCardCollectionItemRecordBeforeIndex(card.id, arMutation.group, user.id, arMutation.collectionName, before.index);
              newIndex = prior ? (before.index - prior.index) / 2.0 : before.index - 1;
            } else {
              throw new Error("No record with specified before key");
            }
          } else {
            const after = await db.findCardCollectionItemRecordLast(card.id, arMutation.group, user.id, arMutation.collectionName);
            newIndex = after ? after.index + 1 : 1;
          }
          await db.insertCardCollectionItem(card.id, arMutation.group, user.id, arMutation.collectionName, arMutation.key, newIndex, arMutation.value);
          break;
        }
        case "update-record": {
          const urMutation = mutation as UpdateRecordMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, urMutation.group, user.id, urMutation.collectionName, urMutation.key);
          if (existing) {
            await db.updateCardCollectionItemRecord(card.id, urMutation.group, user.id, urMutation.collectionName, urMutation.key, urMutation.value);
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "update-record-field": {
          const urfMutation = mutation as UpdateRecordFieldMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, urfMutation.group, user.id, urfMutation.collectionName, urfMutation.key);
          if (existing) {
            if (urfMutation.value === null) {
              await db.unsetCardCollectionItemField(card.id, urfMutation.group, user.id, urfMutation.collectionName, urfMutation.key, urfMutation.path);
            } else {
              await db.updateCardCollectionItemField(card.id, urfMutation.group, user.id, urfMutation.collectionName, urfMutation.key, urfMutation.path, urfMutation.value);
            }
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "inc-record-field": {
          const irfMutation = mutation as IncrementRecordFieldMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, irfMutation.group, user.id, irfMutation.collectionName, irfMutation.key);
          if (existing) {
            await db.incrementCardCollectionItemField(card.id, irfMutation.group, user.id, irfMutation.collectionName, irfMutation.key, irfMutation.path, irfMutation.incrementBy);
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "delete-record": {
          const drMutation = mutation as DeleteRecordMutation;
          await db.deleteCardCollectionItemRecord(card.id, drMutation.group, user.id, drMutation.collectionName, drMutation.key);
          break;
        }
        case "move-record": {
          const mrMutation = mutation as MoveRecordMutation;
          let modifiedIndex: number;
          if (mrMutation.beforeKey) {
            const before = await db.findCardCollectionItemRecord(card.id, mrMutation.group, user.id, mrMutation.collectionName, mrMutation.beforeKey);
            if (before) {
              const prior = await db.findFirstCardCollectionItemRecordBeforeIndex(card.id, mrMutation.group, user.id, mrMutation.collectionName, before.index);
              modifiedIndex = prior ? (before.index - prior.index) / 2.0 : before.index - 1;
            } else {
              throw new Error("No record with specified before key");
            }
          } else {
            const after = await db.findCardCollectionItemRecordLast(card.id, mrMutation.group, user.id, mrMutation.collectionName);
            modifiedIndex = after ? after.index + 1 : 1;
          }
          await db.updateCardCollectionItemIndex(card.id, mrMutation.group, user.id, mrMutation.collectionName, mrMutation.key, modifiedIndex);
          break;
        }
        default:
          throw new Error("Unhandled mutation type " + mutation.type);
      }
      // The "at" must be monotonically increasing, so we guarantee this by finding the last
      // one in the group and ensuring the new at is larger than that one.
      let at = Date.now();
      const lastMutation = await db.findLastMutation(card.id, mutation.group);
      if (lastMutation && lastMutation.at >= at) {
        at = lastMutation.at + 1;
      }
      const mutationRecord = await db.insertMutation(card.id, mutation.group, user.id, mutation, at);
      await this.announceMutation(mutationRecord, user);
    } finally {
      if (card) {
        await this.unlockCard(card);
      }
    }
  }

  private async announceCard(card: CardRecord, user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'card-posted',
      user: user.id,
      card: card.id
    };
    await awsManager.sendSns(notification);
  }

  private async announceMutation(mutationRecord: CardMutationRecord, user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'mutation',
      user: user.id,
      card: mutationRecord.cardId,
      mutation: mutationRecord.mutationId
    };
    await awsManager.sendSns(notification);
  }

  async handleNotification(notification: ChannelsServerNotification): Promise<void> {
    switch (notification.type) {
      case 'card-posted':
        await this.handleCardPostedNotification(notification);
        break;
      case 'mutation':
        await this.mutationSemaphore(this.handleMutationNotification(notification)); // this ensures that this won't be called twice concurrently
        break;
      default:
        throw new Error("Unhandled notification type " + notification.type);
    }
  }

  private async handleCardPostedNotification(notification: ChannelsServerNotification): Promise<void> {
    const addresses = socketServer.getOpenSocketAddresses();
    if (addresses.length === 0) {
      return;
    }
    const card = await db.findCardById(notification.card, false);
    if (!card) {
      console.warn("CardManager.handleCardPostedNotification: missing card", notification);
      return;
    }
    const promises: Array<Promise<void>> = [];
    for (const address of addresses) {
      // TODO: only send to users based on their feed configuration
      // promises.push(this.sendCardPostedNotification(card.id, address));
    }
    console.log("CardManager.handleCardPostedNotification: Notifying " + addresses.length + " clients");
    await Promise.all(promises);
  }

  private async sendCardPostedNotification(cardId: string, user: UserRecord, address: string): Promise<void> {
    const cardDescriptor = await this.populateCardState(cardId, false, false, user);
    const details: NotifyCardPostedDetails = cardDescriptor;
    // await socketServer.sendEvent([address], { type: 'notify-card-posted', details: details });
  }

  private async handleMutationNotification(notification: ChannelsServerNotification): Promise<void> {
    const addresses = socketServer.getOpenSocketAddresses();
    if (addresses.length === 0) {
      return;
    }
    const toSend = await db.findMutationsAfterIndex(this.lastMutationIndexSent);
    for (const mutation of toSend) {
      const details: NotifyCardMutationDetails = {
        mutationId: mutation.mutationId,
        cardId: mutation.cardId,
        at: mutation.at,
        by: mutation.by,
        mutation: mutation.mutation
      };
      // TODO: only send to subset of addresses based on user feed
      await socketServer.sendEvent(addresses, { type: 'notify-mutation', details: details });
      this.lastMutationIndexSent = mutation.index;
    }
  }

  async populateCardState(cardId: string, includeState: boolean, promoted: boolean, user?: UserRecord, includeAdmin = false): Promise<CardDescriptor> {
    const record = await cardManager.lockCard(cardId);
    if (!record) {
      return null;
    }
    const basePrice = await priceRegulator.getBaseCardFee();
    const userInfo = user ? await db.findUserCardInfo(user.id, cardId) : null;
    const author = await this.getUser(record.by.id, false);
    const packageRootUrl = await channelsComponentManager.getPackageRootUrl(record.cardType.package);
    if (!packageRootUrl) {
      return null;
    }
    let iconUrl: string;
    if (typeof packageRootUrl !== 'string' || typeof record.cardType.iconUrl !== 'string') {
      console.warn("CardManager.populateCardState: invalid packageRoot or iconUrl");
    } else {
      iconUrl = url.resolve(packageRootUrl, record.cardType.iconUrl);
    }
    try {
      const card: CardDescriptor = {
        id: record.id,
        postedAt: record.postedAt,
        by: {
          address: author ? author.address : record.by.address,
          handle: author ? author.identity.handle : record.by.handle,
          name: author ? author.identity.name : record.by.name,
          imageUrl: author ? author.identity.imageUrl : record.by.imageUrl,
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: record.summary.imageUrl,
          imageWidth: record.summary.imageWidth,
          imageHeight: record.summary.imageHeight,
          linkUrl: record.summary.linkUrl,
          title: record.summary.title,
          text: record.summary.text,
        },
        keywords: record.keywords,
        private: record.private,
        cardType: {
          package: record.cardType.package,
          iconUrl: iconUrl,
          royaltyAddress: record.cardType.royaltyAddress,
          royaltyFraction: record.cardType.royaltyFraction
        },
        pricing: {
          promotionFee: record.pricing.promotionFee,
          openFeeUnits: record.pricing.openFeeUnits,
          openFee: record.pricing.openFeeUnits > 0 ? record.pricing.openFeeUnits * basePrice : -record.pricing.openPayment,
        },
        promoted: promoted,
        couponId: record.couponIds.length > 0 ? record.couponIds[record.couponIds.length - 1] : null,
        stats: {
          revenue: record.stats.revenue.value,
          promotionsPaid: record.stats.promotionsPaid.value,
          openFeesPaid: record.stats.openFeesPaid.value,
          impressions: record.stats.impressions.value,
          uniqueImpressions: record.stats.uniqueImpressions.value,
          opens: record.stats.opens.value,
          uniqueOpens: record.stats.uniqueOpens.value,
          likes: record.stats.likes.value,
          dislikes: record.stats.dislikes.value
        },
        score: record.score,
        userSpecific: {
          isPoster: user && record.by.id === user.id ? true : false,
          lastImpression: userInfo ? userInfo.lastImpression : 0,
          lastOpened: userInfo ? userInfo.lastOpened : 0,
          lastClosed: userInfo ? userInfo.lastClosed : 0,
          likeState: userInfo ? userInfo.like : "none",
          paidToAuthor: userInfo ? userInfo.paidToAuthor : 0,
          paidToReader: userInfo ? userInfo.paidToReader : 0,
          earnedFromAuthor: userInfo ? userInfo.earnedFromAuthor : 0,
          earnedFromReader: userInfo ? userInfo.earnedFromReader : 0
        },
        blocked: (includeAdmin || user && user.admin) && record.curation && record.curation.block ? true : false
      };
      if (record.curation && record.curation.boost) {
        card.boost = record.curation.boost;
      }
      if (includeState) {
        card.state = {
          user: {
            mutationId: null,
            properties: {},
            collections: {}
          },
          shared: {
            mutationId: null,
            properties: {},
            collections: {}
          }
        };
      }
      if (user) {
        const lastUserMutation = await db.findLastMutation(card.id, "user");
        if (lastUserMutation) {
          card.state.user.mutationId = lastUserMutation.mutationId;
        }
        const userProperties = await db.findCardProperties(card.id, "user", user.id);
        for (const property of userProperties) {
          card.state.user.properties[property.name] = property.value;
        }
        const userCollections = await db.findCardCollections(card.id, "user", user.id);
        for (const collection of userCollections) {
          card.state.user.collections[collection.collectionName] = {
            records: []
          };
          if (collection.keyField) {
            card.state.user.collections[collection.collectionName].keyField = collection.keyField;
          }
          const userCollectionRecords = await db.findCardCollectionItems(card.id, "user", user.id, collection.collectionName);
          for (const item of userCollectionRecords) {
            card.state.user.collections[collection.collectionName].records.push(item.value);
          }
        }
      }
      const lastSharedMutation = await db.findLastMutation(card.id, "shared");
      if (lastSharedMutation) {
        card.state.shared.mutationId = lastSharedMutation.mutationId;
      }
      if (includeState) {
        const sharedProperties = await db.findCardProperties(card.id, "shared", '');
        for (const property of sharedProperties) {
          card.state.shared.properties[property.name] = property.value;
        }
        const sharedCollections = await db.findCardCollections(card.id, "shared", '');
        for (const collection of sharedCollections) {
          card.state.shared.collections[collection.collectionName] = {
            records: []
          };
          if (collection.keyField) {
            card.state.shared.collections[collection.collectionName].keyField = collection.keyField;
          }
          const sharedCollectionRecords = await db.findCardCollectionItems(card.id, "shared", '', collection.collectionName);
          for (const item of sharedCollectionRecords) {
            card.state.shared.collections[collection.collectionName].records.push(item.value);
          }
        }
      }
      return card;
    } finally {
      await cardManager.unlockCard(record);
    }
  }

  private async incrementStat(card: CardRecord, statName: string, incrementBy: number, at: number, snapshotInterval: number): Promise<void> {
    const cardStatistic = (card.stats as any)[statName] as CardStatistic;
    if (cardStatistic) {
      let lastSnapshot: number;
      if (cardStatistic.lastSnapshot === 0 || at - card.postedAt > snapshotInterval || cardStatistic.lastSnapshot > 0 && at - cardStatistic.lastSnapshot > snapshotInterval) {
        await db.insertCardStatsHistory(card.id, statName, cardStatistic.value, at);
        lastSnapshot = at;
      }
      await db.incrementCardStat(card, statName, incrementBy, lastSnapshot, this.getPromotionScores(card));
    } else {
      await db.addCardStat(card, statName, incrementBy);
    }
  }

  async updateCardScore(card: CardRecord, score: number): Promise<void> {
    await db.updateCardScore(card, score);
  }

  getPromotionScores(card: CardRecord): CardPromotionScores {
    return this.getPromotionScoresFromData(card.budget.available, card.pricing.openFeeUnits, card.pricing.promotionFee, card.pricing.openPayment, card.stats.uniqueImpressions.value, card.stats.uniqueOpens.value);
  }

  private getPromotionScoresFromData(budgetAvailable: boolean, openFeeUnits: number, promotionFee: number, openPayment: number, uniqueImpressions: number, uniqueOpens: number): CardPromotionScores {
    return {
      a: this.getPromotionScoreFromData(0.9, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens),
      b: this.getPromotionScoreFromData(0.7, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens),
      c: this.getPromotionScoreFromData(0.5, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens),
      d: this.getPromotionScoreFromData(0.3, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens),
      e: this.getPromotionScoreFromData(0.1, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens)
    };
  }

  private getPromotionScoreFromData(ratio: number, budgetAvailable: boolean, openFeeUnits: number, promotionFee: number, openPayment: number, uniqueImpressions: number, uniqueOpens: number): number {
    if (!budgetAvailable) {
      return 0;
    }
    let openProbability = openFeeUnits > 0 ? 0.1 : 0.01;
    if (uniqueImpressions > 100) {
      openProbability = Math.max(openFeeUnits > 0 ? 0.01 : 0.001, uniqueOpens / uniqueImpressions);
    }
    // We're going to increase the openProbability as the ratio decreases (user more likely to open to earn money)
    // if the card pays based on opens
    let boost = 1;
    if (openPayment > 0) {
      boost += 4 * (1 - ratio);  // boost of 5X when budget is near zero
    }
    const revenuePotential = promotionFee + openPayment * openProbability * boost;
    const desireability = openProbability * 5;
    return ((1 - ratio) * revenuePotential) + (ratio * desireability);
  }

}

const cardManager = new CardManager();

export { cardManager };
