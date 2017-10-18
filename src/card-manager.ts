import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { CardRecord, UserRecord, CardMutationType, CardMutationRecord, CardStateGroup, Mutation, SetPropertyMutation, AddRecordMutation, UpdateRecordMutation, DeleteRecordMutation, MoveRecordMutation, IncrementPropertyMutation, UpdateRecordFieldMutation, IncrementRecordFieldMutation, CardActionType, BankCouponDetails } from "./interfaces/db-records";
import { db } from "./db";
import { configuration } from "./configuration";
import * as AWS from 'aws-sdk';
import { awsManager, NotificationHandler, ChannelsServerNotification } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { socketServer, CardHandler } from "./socket-server";
import { NotifyCardPostedDetails, NotifyCardMutationDetails, BankTransactionResult } from "./interfaces/socket-messages";
import { CardDescriptor, RestRequest, GetCardDetails, GetCardResponse, PostCardDetails, PostCardResponse, CardImpressionDetails, CardImpressionResponse, CardOpenedDetails, CardOpenedResponse, CardPayDetails, CardPayResponse, CardClosedDetails, CardClosedResponse, UpdateCardLikeDetails, UpdateCardLikeResponse, BankTransactionDetails, CardRedeemOpenDetails } from "./interfaces/rest-services";
import { priceRegulator } from "./price-regulator";
import { RestServer } from "./interfaces/rest-server";
import { UrlManager } from "./url-manager";
import { RestHelper } from "./rest-helper";
import { UserHelper } from "./user-helper";
import { KeyUtils } from "./key-utils";
import { bank } from "./bank";
import { userManager } from "./user-manager";
import { SignedObject } from "./interfaces/signed-object";
import * as uuid from "uuid";
import { networkEntity } from "./network-entity";
import { channelsComponentManager } from "./channels-component-manager";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
const promiseLimit = require('promise-limit');

const CARD_LOCK_TIMEOUT = 1000 * 60;

export class CardManager implements Initializable, NotificationHandler, CardHandler, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private lastMutationIndexSent = 0;
  private mutationSemaphore = promiseLimit(1) as (p: Promise<void>) => Promise<void>;

  async initialize(): Promise<void> {
    awsManager.registerNotificationHandler(this);
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
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
  }

  async initialize2(): Promise<void> {
    const lastMutation = await db.findLastMutationByIndex();
    if (lastMutation) {
      this.lastMutationIndexSent = lastMutation.index;
    }
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
      if (!requestBody.detailsObject.text) {
        response.status(400).send("Invalid request: missing text");
        return;
      }
      // TODO: validate other parts
      const card = await this.postCard(user, requestBody.detailsObject, requestBody.detailsObject.address);
      const reply: PostCardResponse = {
        cardId: card.id
      };
      if (requestBody.detailsObject.state) {
        if (requestBody.detailsObject.state.user) {
          if (requestBody.detailsObject.state.user.properties) {
            for (const key of Object.keys(requestBody.detailsObject.state.user.properties)) {
              await db.upsertCardProperty(card.id, "user", user.id, key, requestBody.detailsObject.state.user.properties[key]);
            }
          }
          if (requestBody.detailsObject.state.user.collections) {
            for (const key of Object.keys(requestBody.detailsObject.state.user.collections)) {
              const collection = requestBody.detailsObject.state.user.collections[key];
              let index = 0;
              for (const itemKey of Object.keys(collection)) {
                await db.insertCardCollectionItem(card.id, "user", user.id, key, itemKey, index, collection[itemKey]);
                index++;
              }
            }
          }
        }
        if (requestBody.detailsObject.state.shared) {
          if (requestBody.detailsObject.state.shared.properties) {
            for (const key of Object.keys(requestBody.detailsObject.state.shared.properties)) {
              await db.upsertCardProperty(card.id, "shared", '', key, requestBody.detailsObject.state.shared.properties[key]);
            }
          }
          if (requestBody.detailsObject.state.shared.collections) {
            for (const key of Object.keys(requestBody.detailsObject.state.shared.collections)) {
              const collection = requestBody.detailsObject.state.shared.collections[key];
              let index = 0;
              for (const itemKey of Object.keys(collection)) {
                await db.insertCardCollectionItem(card.id, "shared", '', key, itemKey, index, collection[itemKey]);
                index++;
              }
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
        if (info.earned > 0) {
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
        if (!UserHelper.isUsersAddress(author, coupon.byAddress)) {
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
      await db.insertUserCardAction(user.id, card.id, now, "impression", 0, null, 0, null, 0, null);
      await db.updateUserCardLastImpression(user.id, card.id, now);
      await db.incrementCardImpressions(card.id, 1);
      let transactionResult: BankTransactionResult;
      if (requestBody.detailsObject.couponId) {
        transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.address, requestBody.detailsObject.couponId);
        await db.insertUserCardAction(user.id, card.id, now, "redeem-promotion", 0, null, transactionResult.record.details.amount, transactionResult.record.id, 0, null);
        await db.incrementCardPromotionsPaid(card.id, transactionResult.record.details.amount);
      }
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardImpressionResponse = {
        transactionId: transactionResult ? transactionResult.record.id : null,
        status: userStatus.status,
        interestRatePerMillisecond: userStatus.interestRatePerMillisecond,
        cardBasePrice: userStatus.cardBasePrice,
        subsidyRate: userStatus.subsidyRate,
        operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
        operatorAddress: networkEntity.getOperatorAddress(),
        networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
        networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
        referralFraction: networkEntity.getReferralFraction()
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
      await db.insertUserCardAction(user.id, card.id, now, "open", 0, null, 0, null, 0, null);
      await db.updateUserCardLastOpened(user.id, card.id, now);
      await db.incrementCardOpens(card.id, 1);
      const reply: CardOpenedResponse = {};
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
      if (!UserHelper.isUsersAddress(user, transaction.address)) {
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
      const transactionResult = await bank.performTransfer(user, requestBody.detailsObject.address, requestBody.detailsObject.transaction, card.summary.title);
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "pay", 0, null, 0, null, 0, null);
      await db.incrementCardRevenue(card.id, transaction.amount);
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardPayResponse = {
        transactionId: transactionResult.record.id,
        status: userStatus.status,
        interestRatePerMillisecond: userStatus.interestRatePerMillisecond,
        cardBasePrice: userStatus.cardBasePrice,
        subsidyRate: userStatus.subsidyRate,
        totalCardRevenue: card.revenue.value + transaction.amount,
        operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
        operatorAddress: networkEntity.getOperatorAddress(),
        networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
        networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
        referralFraction: networkEntity.getReferralFraction()
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
      if (info.earned > 0) {
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
      if (!UserHelper.isUsersAddress(author, coupon.byAddress)) {
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
      const now = Date.now();
      await db.insertUserCardAction(user.id, card.id, now, "redeem-open-payment", 0, null, 0, null, coupon.amount, transactionResult.record.id);
      await db.incrementCardOpenFeesPaid(card.id, coupon.amount);
      const userStatus = await userManager.getUserStatus(user);
      const reply: CardPayResponse = {
        transactionId: transactionResult.record.id,
        status: userStatus.status,
        interestRatePerMillisecond: userStatus.interestRatePerMillisecond,
        cardBasePrice: userStatus.cardBasePrice,
        subsidyRate: userStatus.subsidyRate,
        totalCardRevenue: card.revenue.value,
        operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
        operatorAddress: networkEntity.getOperatorAddress(),
        networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
        networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
        referralFraction: networkEntity.getReferralFraction()
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
      const reply: CardClosedResponse = {};
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
          await db.updateUserCardInfoLikeState(user.id, card.id, requestBody.detailsObject.selection);
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
          await db.insertUserCardAction(user.id, card.id, Date.now(), action, 0, null, 0, null, 0, null);
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
          await db.incrementCardLikes(card.id, deltaLikes, deltaDislikes);
        }
      }
      const reply: UpdateCardLikeResponse = {};
      response.json(reply);
    } catch (err) {
      console.error("User.handleUpdateCardLike: Failure", err);
      response.status(500).send(err);
    }
  }

  private async getRequestedCard(user: UserRecord, cardId: string, response: Response): Promise<CardRecord> {
    const card = await db.findCardById(cardId);
    if (!card) {
      response.status(404).send("No such card");
      return null;
    }
    return card;
  }

  async postCard(user: UserRecord, details: PostCardDetails, byAddress: string): Promise<CardRecord> {
    if (!details.text) {
      throw new ErrorWithStatusCode(400, "Invalid card: missing text");
    }
    const componentResponse = await channelsComponentManager.ensureComponent(details.cardType);
    let couponId: string;
    const cardId = uuid.v4();
    if (details.coupon) {
      const couponRecord = await bank.registerCoupon(user, cardId, details.coupon);
      couponId = couponRecord.id;
    }
    const card = await db.insertCard(user.id, byAddress, user.identity.handle, user.identity.name, user.identity.imageUrl, details.imageUrl, details.linkUrl, details.title, details.text, details.cardType, componentResponse.iconUrl, componentResponse.channelComponent.developerAddress, componentResponse.channelComponent.developerFraction, details.promotionFee, details.openPayment, details.openFeeUnits, details.budget ? details.budget.amount : 0, details.budget ? details.budget.plusPercent : 0, details.coupon, couponId, cardId);
    await this.announceCard(card, user);
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
    const card = await db.findCardById(notification.card);
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

  async populateCardState(cardId: string, includeInitialState: boolean, user?: UserRecord): Promise<CardDescriptor> {
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
          linkUrl: record.summary.linkUrl,
          title: record.summary.title,
          text: record.summary.text,
        },
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
        history: {
          revenue: record.revenue.value,
          likes: record.likes.value,
          dislikes: record.dislikes.value,
          opens: record.opens.value,
          impressions: record.impressions.value
        },
        score: record.score.value,
        userSpecific: {
          isPoster: user ? UserHelper.isUsersAddress(user, record.by.address) : false,
          lastImpression: userInfo ? userInfo.lastImpression : 0,
          lastOpened: userInfo ? userInfo.lastOpened : 0,
          lastClosed: userInfo ? userInfo.lastClosed : 0,
          likeState: userInfo ? userInfo.like : "none",
          paid: userInfo ? userInfo.paid : 0,
          earned: userInfo ? userInfo.earned : 0
        }
      };
      if (includeInitialState) {
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
        if (includeInitialState) {
          const userProperties = await db.findCardProperties(card.id, "user", user.id);
          for (const property of userProperties) {
            card.state.user.properties[property.name] = property.value;
          }
          // TODO: if a lot of state information, omit it and let client ask if it
          // needs it
          const userCollectionRecords = await db.findCardCollectionItems(card.id, "user", user.id);
          for (const item of userCollectionRecords) {
            if (!card.state.user.collections[item.collectionName]) {
              card.state.user.collections[item.collectionName] = {};
              card.state.user.collections[item.collectionName][item.key] = item.value;
            }
          }
        }
      }
      const lastSharedMutation = await db.findLastMutation(card.id, "shared");
      if (lastSharedMutation) {
        card.state.shared.mutationId = lastSharedMutation.mutationId;
      }
      if (includeInitialState) {
        const sharedProperties = await db.findCardProperties(card.id, "shared", '');
        for (const property of sharedProperties) {
          card.state.shared.properties[property.name] = property.value;
        }
        const sharedCollectionRecords = await db.findCardCollectionItems(card.id, "shared", '');
        for (const item of sharedCollectionRecords) {
          if (!card.state.shared.collections[item.collectionName]) {
            card.state.shared.collections[item.collectionName] = {};
            card.state.shared.collections[item.collectionName][item.key] = item.value;
          }
        }
      }
      return card;
    } finally {
      await cardManager.unlockCard(record);
    }
  }
}

const cardManager = new CardManager();

export { cardManager };
