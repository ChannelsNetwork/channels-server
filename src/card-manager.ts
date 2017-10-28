import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { CardRecord, UserRecord, CardMutationType, CardMutationRecord, CardStateGroup, Mutation, SetPropertyMutation, AddRecordMutation, UpdateRecordMutation, DeleteRecordMutation, MoveRecordMutation, IncrementPropertyMutation, UpdateRecordFieldMutation, IncrementRecordFieldMutation, CardActionType, BankCouponDetails, CardStatistic } from "./interfaces/db-records";
import { db } from "./db";
import { configuration } from "./configuration";
import * as AWS from 'aws-sdk';
import { awsManager, NotificationHandler, ChannelsServerNotification } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { socketServer, CardHandler } from "./socket-server";
import { NotifyCardPostedDetails, NotifyCardMutationDetails, BankTransactionResult } from "./interfaces/socket-messages";
import { CardDescriptor, RestRequest, GetCardDetails, GetCardResponse, PostCardDetails, PostCardResponse, CardImpressionDetails, CardImpressionResponse, CardOpenedDetails, CardOpenedResponse, CardPayDetails, CardPayResponse, CardClosedDetails, CardClosedResponse, UpdateCardLikeDetails, UpdateCardLikeResponse, BankTransactionDetails, CardRedeemOpenDetails, CardRedeemOpenResponse, UpdateCardPrivateDetails, DeleteCardDetails, DeleteCardResponse, CardStatsHistoryDetails, CardStatsHistoryResponse, CardStatDatapoint, UpdateCardPrivateResponse } from "./interfaces/rest-services";
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
import * as Mustache from 'mustache';
import * as path from 'path';
import * as fs from 'fs';
import * as escapeHtml from 'escape-html';

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

export class CardManager implements Initializable, NotificationHandler, CardHandler, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private lastMutationIndexSent = 0;
  private mutationSemaphore = promiseLimit(1) as (p: Promise<void>) => Promise<void>;
  private cardTemplate: string;

  async initialize(): Promise<void> {
    awsManager.registerNotificationHandler(this);
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
  }

  async initialize2(): Promise<void> {
    const lastMutation = await db.findLastMutationByIndex();
    if (lastMutation) {
      this.lastMutationIndexSent = lastMutation.index;
    }
    const appPath = path.join(__dirname, '../templates/web/card.html');
    this.cardTemplate = fs.readFileSync(appPath, 'utf8');
  }

  private async handleCardRequest(request: Request, response: Response): Promise<void> {
    const card = await db.findCardById(request.params.cardId, false);
    if (!card) {
      response.redirect('/');
      return;
    }
    const ogUrl = configuration.get('baseClientUri');
    const view = {
      og_title: escapeHtml(card.summary.title),
      og_description: escapeHtml(card.summary.text),
      og_url: this.urlManager.getAbsoluteUrl('/c/' + card.id),
      og_image: card.summary.imageUrl,
      og_imagewidth: card.summary.imageWidth,
      og_imageheight: card.summary.imageHeight,
      clientPageUrl: this.urlManager.getAbsoluteUrl('/app/#feed/' + card.id)
    };
    const output = Mustache.render(this.cardTemplate, view);
    response.setHeader("Cache-Control", 'public, max-age=' + 600);
    response.contentType('text/html');
    response.status(200).send(output);
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
      const cardState = await this.populateCardState(card.id, true, user);
      const reply: GetCardResponse = {
        serverVersion: SERVER_VERSION,
        card: cardState
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleGetCard: Failure", err);
      response.status(500).send(err);
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
        if (requestBody.detailsObject.sharedState.properties) {
          for (const key of Object.keys(requestBody.detailsObject.sharedState.properties)) {
            await db.upsertCardProperty(card.id, "shared", '', key, requestBody.detailsObject.sharedState.properties[key]);
          }
        }
        if (requestBody.detailsObject.sharedState.collections) {
          for (const key of Object.keys(requestBody.detailsObject.sharedState.collections)) {
            const collection = requestBody.detailsObject.sharedState.collections[key];
            await db.insertCardCollection(card.id, 'shared', '', key, collection.keyField);
            let index = 0;
            for (const record of collection.records) {
              await db.insertCardCollectionItem(card.id, "shared", '', key, collection.keyField ? record[collection.keyField] : index.toString(), index, record);
              index++;
            }
          }
        }
      }
      response.json(reply);
    } catch (err) {
      console.error("User.handlePostCard: Failure", err);
      response.status(500).send(err);
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
      if (requestBody.detailsObject.couponId) {
        if (card.pricing.promotionFee <= 0) {
          response.status(400).send("No promotion fee paid on this card");
          return;
        }
        const info = await db.ensureUserCardInfo(user.id, card.id);
        if (info.earnedFromAuthor > 0) {
          response.status(400).send("You have already been paid a promotion on this card");
          return;
        }
        author = await db.findUserById(card.by.id);
        if (!author) {
          response.status(404).send("The author no longer has an account.");
          return;
        }
        if (author.balance < card.pricing.promotionFee) {
          response.status(402).send("The author does not have sufficient funds.");
          return;
        }
        const coupon = await db.findBankCouponById(requestBody.detailsObject.couponId);
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
      if (requestBody.detailsObject.couponId) {
        transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.address, requestBody.detailsObject.couponId);
        await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        await db.insertUserCardAction(user.id, card.id, now, "redeem-promotion", 0, null, transactionResult.record.details.amount, transactionResult.record.id, 0, null);
        await this.incrementStat(card, "promotionsPaid", transactionResult.record.details.amount, now, PROMOTIONS_PAID_SNAPSHOT_INTERVAL);
      }
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardImpressionResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult ? transactionResult.record.id : null,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardImpression: Failure", err);
      response.status(500).send(err);
    }
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
      if (!userCard || !userCard.lastOpened) {
        await this.incrementStat(card, "uniqueOpens", 1, now, UNIQUE_OPENS_SNAPSHOT_INTERVAL);
      }
      await this.incrementStat(card, "opens", 1, now, OPENS_SNAPSHOT_INTERVAL);
      await db.insertUserCardAction(user.id, card.id, now, "open", 0, null, 0, null, 0, null);
      await db.updateUserCardLastOpened(user.id, card.id, now);
      const reply: CardOpenedResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardOpened: Failure", err);
      response.status(500).send(err);
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
      const author = await db.findUserByAddress(card.by.address);
      if (!author) {
        response.status(404).send("The author of this card is missing");
        return;
      }
      let authorRecipient = false;
      for (const recipient of transaction.toRecipients) {
        if (recipient.address === card.by.address && recipient.portion === 'remainder') {
          authorRecipient = true;
          break;
        }
      }
      if (!authorRecipient) {
        response.status(400).send("The card's author is missing as a recipient with 'remainder'.");
        return;
      }
      console.log("CardManager.card-pay", requestBody.detailsObject, user.balance, transaction.amount);
      const transactionResult = await bank.performTransfer(user, requestBody.detailsObject.address, requestBody.detailsObject.transaction, card.summary.title, false, true, true);
      await db.updateUserCardIncrementPaidToAuthor(user.id, card.id, transaction.amount, transactionResult.record.id);
      await db.updateUserCardIncrementEarnedFromReader(card.by.id, card.id, transaction.amount, transactionResult.record.id);
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "pay", 0, null, 0, null, 0, null);
      await this.incrementStat(card, "revenue", transaction.amount, now, REVENUE_SNAPSHOT_INTERVAL);
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardPayResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        totalCardRevenue: card.stats.revenue.value,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleCardPay: Failure", err);
      response.status(500).send(err);
    }
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
        response.status(400).send("You have already been paid for opening this card");
        return;
      }
      const author = await db.findUserById(card.by.id);
      if (!author) {
        response.status(404).send("The author no longer has an account.");
        return;
      }
      if (author.balance < card.pricing.openPayment) {
        response.status(402).send("The author does not have sufficient funds.");
        return;
      }
      const coupon = await db.findBankCouponById(requestBody.detailsObject.couponId);
      if (!coupon) {
        response.status(404).send("No such coupon found");
        return;
      }
      if (coupon.cardId !== card.id) {
        response.status(400).send("Invalid coupon: card mismatch");
        return;
      }
      if (author.address !== coupon.byAddress) {
        response.status(400).send("Invalid coupon: author mismatch");
        return;
      }
      if (coupon.amount !== card.pricing.openPayment) {
        response.status(400).send("Invalid coupon: open fee mismatch");
        return;
      }
      if (coupon.reason !== 'card-open-payment') {
        response.status(400).send("Invalid coupon: invalid type");
        return;
      }
      console.log("CardManager.card-redeem-open-payment", requestBody.detailsObject);
      const transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.address, coupon.id);
      await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "redeem-open-payment", 0, null, 0, null, coupon.amount, transactionResult.record.id);
      await this.incrementStat(card, "openFeesPaid", coupon.amount, now, OPEN_FEES_PAID_SNAPSHOT_INTERVAL);
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardRedeemOpenResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleRedeemCardOpen: Failure", err);
      response.status(500).send(err);
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
      response.status(500).send(err);
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
          await db.updateUserCardInfoLikeState(user.id, card.id, requestBody.detailsObject.selection);
          cardInfo.like = requestBody.detailsObject.selection;
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
          }
          if (deltaDislikes !== 0) {
            await this.incrementStat(card, "dislikes", deltaDislikes, now, LIKE_DISLIKE_SNAPSHOT_INTERVAL);
          }
        }
      }
      const reply: UpdateCardLikeResponse = {
        serverVersion: SERVER_VERSION,
        newValue: cardInfo.like
      };
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateCardLike: Failure", err);
      response.status(500).send(err);
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
      response.status(500).send(err);
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
      response.status(500).send(err);
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
      response.status(500).send(err);
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
    details.promotionFee = details.promotionFee || 0;
    details.openFeeUnits = details.openFeeUnits || 0;
    details.openPayment = details.openPayment || 0;
    if (details.openPayment > 0 || details.promotionFee > 0) {
      if (!details.budget) {
        throw new ErrorWithStatusCode(400, "You must provide a budget if you offer payment.");
      }
      details.budget.amount = details.budget.amount || 0;
      details.budget.plusPercent = details.budget.plusPercent || 0;
      if (details.budget.amount < 1) {
        throw new ErrorWithStatusCode(400, "Minimum budget is ℂ1.");
      }
      if (details.budget.amount > user.balance - 1) {
        throw new ErrorWithStatusCode(400, "Budget exceeds your balance (leaving at least ℂ1 to spare).");
      }
      if (details.budget.plusPercent < 0 || details.budget.plusPercent > 90) {
        throw new ErrorWithStatusCode(400, "Budget plusPercent must be between 0 and 90.");
      }
    }
    if (details.promotionFee < 0 || details.openPayment < 0) {
      throw new ErrorWithStatusCode(400, "Promotion fee and openPayment must be greater than or equal to zero.");
    }
    if (details.openPayment > 0 && details.promotionFee > 0) {
      throw new ErrorWithStatusCode(400, "You can't declare both an openPayment and a promotionFee.");
    }
    details.openFeeUnits = Math.round(details.openFeeUnits);
    if (details.promotionFee === 0 && details.openPayment === 0 && details.openFeeUnits === 0) {
      throw new ErrorWithStatusCode(400, "Not all of promotionFee, openPayment and openFeeUnits can be zero.");
    }
    if (details.openPayment > 0 && details.openFeeUnits > 0) {
      throw new ErrorWithStatusCode(400, "openPayment and openFeeUnits cannot both be non-zero.");
    }
    if (details.openPayment === 0 && (details.openFeeUnits < 0 || details.openFeeUnits > 10)) {
      throw new ErrorWithStatusCode(400, "OpenFeeUnits must be between 1 and 10.");
    }
    details.private = details.private ? true : false;
    const componentResponse = await channelsComponentManager.ensureComponent(details.cardType);
    let couponId: string;
    const cardId = uuid.v4();
    if (details.coupon) {
      const couponRecord = await bank.registerCoupon(user, cardId, details.coupon);
      couponId = couponRecord.id;
    }
    const card = await db.insertCard(user.id, byAddress, user.identity.handle, user.identity.name, user.identity.imageUrl, details.imageUrl, details.imageWidth, details.imageHeight, details.linkUrl, details.title, details.text, details.private, details.cardType, componentResponse.iconUrl, componentResponse.channelComponent.developerAddress, componentResponse.channelComponent.developerFraction, details.promotionFee, details.openPayment, details.openFeeUnits, details.budget ? details.budget.amount : 0, details.budget ? details.budget.plusPercent : 0, details.coupon, couponId, cardId);
    await this.announceCard(card, user);
    if (configuration.get("notifications.postCard")) {
      let html = "<div>";
      html += "<div>User: " + user.identity.name + "</div>";
      html += "<div>Handle: " + user.identity.handle + "</div>";
      html += "<div>Title: " + details.title + "</div>";
      html += "<div>Text: " + details.text + "</div>";
      html += "<div>CardType: " + details.cardType + "</div>";
      html += "<div>Private: " + details.private + "</div>";
      if (details.promotionFee) {
        html += "<div>Promotion fee: " + details.promotionFee + "</div>";
      }
      if (details.openFeeUnits) {
        html += "<div>Open fee (units): " + details.openFeeUnits + "</div>";
      }
      if (details.openPayment) {
        html += "<div>Open payment: " + details.openPayment + "</div>";
      }
      html += "</div>";
      void emailManager.sendInternalNotification("Card posted", "", html);
    }
    return card;
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
    const cardDescriptor = await this.populateCardState(cardId, false, user);
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

  async populateCardState(cardId: string, includeState: boolean, user?: UserRecord): Promise<CardDescriptor> {
    const record = await cardManager.lockCard(cardId);
    if (!record) {
      return null;
    }
    const basePrice = await priceRegulator.getBaseCardFee();
    const userInfo = user ? await db.findUserCardInfo(user.id, cardId) : null;
    try {
      const card: CardDescriptor = {
        id: record.id,
        postedAt: record.postedAt,
        by: {
          address: record.by.address,
          handle: record.by.handle,
          name: record.by.name,
          imageUrl: record.by.imageUrl,
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
        private: record.private,
        cardType: {
          package: record.cardType.package,
          iconUrl: record.cardType.iconUrl,
          royaltyAddress: record.cardType.royaltyAddress,
          royaltyFraction: record.cardType.royaltyFraction
        },
        pricing: {
          promotionFee: record.pricing.promotionFee,
          openFeeUnits: record.pricing.openFeeUnits,
          openFee: record.pricing.openFeeUnits > 0 ? record.pricing.openFeeUnits * basePrice : -record.pricing.openPayment,
        },
        couponId: record.couponId,
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
        }
      };
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
      if (cardStatistic.lastSnapshot === 0 && at - card.postedAt > snapshotInterval || cardStatistic.lastSnapshot > 0 && at - cardStatistic.lastSnapshot > snapshotInterval) {
        await db.insertCardStatsHistory(card.id, statName, cardStatistic.value, at);
        lastSnapshot = at;
      }
      await db.incrementCardStat(card, statName, incrementBy, lastSnapshot);
    } else {
      await db.addCardStat(card, statName, incrementBy);
    }
  }

  async updateCardScore(card: CardRecord, score: number): Promise<void> {
    await db.updateCardScore(card, score);
  }
}

const cardManager = new CardManager();

export { cardManager };
