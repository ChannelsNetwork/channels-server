import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { CardRecord, UserRecord, CardMutationType, CardMutationRecord, CardStateGroup, Mutation, SetPropertyMutation, AddRecordMutation, UpdateRecordMutation, DeleteRecordMutation, MoveRecordMutation, IncrementPropertyMutation, UpdateRecordFieldMutation, IncrementRecordFieldMutation, CardActionType, BankCouponDetails, CardStatistic, CardPromotionScores, NetworkCardStats, PublisherSubsidyDayRecord, ImageInfo, CardPaymentFraudReason, UserCardActionPaymentInfo, CardPaymentCategory, AdSlotStatus, UserCardActionReportInfo, ChannelCardRecord, CardCommentRecord } from "./interfaces/db-records";
import { db } from "./db";
import { configuration } from "./configuration";
import * as AWS from 'aws-sdk';
import { awsManager, NotificationHandler, ChannelsServerNotification } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { socketServer, CardHandler } from "./socket-server";
import { NotifyCardPostedDetails, NotifyCardMutationDetails, BankTransactionResult } from "./interfaces/socket-messages";
import { CardDescriptor, RestRequest, GetCardDetails, GetCardResponse, PostCardDetails, PostCardResponse, CardImpressionDetails, CardImpressionResponse, CardOpenedDetails, CardOpenedResponse, CardPayDetails, CardPayResponse, CardClosedDetails, CardClosedResponse, UpdateCardLikeDetails, UpdateCardLikeResponse, BankTransactionDetails, CardRedeemOpenDetails, CardRedeemOpenResponse, UpdateCardPrivateDetails, DeleteCardDetails, DeleteCardResponse, CardStatsHistoryDetails, CardStatsHistoryResponse, CardStatDatapoint, UpdateCardPrivateResponse, UpdateCardStateDetails, UpdateCardStateResponse, UpdateCardPricingDetails, UpdateCardPricingResponse, CardPricingInfo, BankTransactionRecipientDirective, AdminUpdateCardDetails, AdminUpdateCardResponse, CardClickedResponse, CardClickedDetails, PublisherSubsidiesInfo, CardState, CardSummary, FileMetadata, ReportCardDetails, ReportCardResponse, CommentorInfo, CardCommentDescriptor, PostCardCommentResponse, PostCardCommentDetails, GetCardCommentsDetails, GetCardCommentsResponse, AdminGetCommentsDetails, AdminGetCommentsResponse, AdminCommentInfo, AdminSetCommentCurationDetails, AdminSetCommentCurationResponse, ChannelCardPinInfo } from "./interfaces/rest-services";
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
import { emailManager, EmailButton } from "./email-manager";
import { SERVER_VERSION } from "./server-version";
import * as url from 'url';
import { Utils } from "./utils";
import { rootPageManager } from "./root-page-manager";
import { fileManager } from "./file-manager";
import { feedManager } from "./feed-manager";
import { channelManager } from "./channel-manager";
import { errorManager } from "./error-manager";
import * as LRU from 'lru-cache';
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
const CLICKS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const UNIQUE_CLICKS_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const OPEN_FEES_PAID_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const CLICK_FEES_PAID_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const LIKE_DISLIKE_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const CARD_REPORT_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const CARD_REFUND_SNAPSHOT_INTERVAL = DEFAULT_STAT_SNAPSHOT_INTERVAL;
const DEFAULT_CARD_PAYMENT_DELAY = 1000 * 10;
const CARD_PAYMENT_DELAY_PER_LEVEL = 1000 * 5;
const MINIMUM_USER_FRAUD_AGE = 1000 * 60 * 15;
const REPEAT_CARD_PAYMENT_DELAY = 1000 * 15;
const PUBLISHER_SUBSIDY_RETURN_VIEWER_MULTIPLIER = 2;
const PUBLISHER_SUBSIDY_MAX_CARD_AGE = 1000 * 60 * 60 * 24 * 2;
const FIRST_CARD_PURCHASE_AMOUNT = 0.01;
const MINIMUM_COMMENT_NOTIFICATION_INTERVAL = 1000 * 60 * 60 * 3;

const MAX_SEARCH_STRING_LENGTH = 2000000;
const INITIAL_BASE_CARD_PRICE = 0.05;
export class CardManager implements Initializable, NotificationHandler, CardHandler, RestServer {
  private app: express.Application;
  private urlManager: UrlManager;
  private lastMutationIndexSent = 0;
  private mutationSemaphore = promiseLimit(1) as (p: Promise<void>) => Promise<void>;
  private cardCache = LRU<string, CardRecord>({ max: 1000, maxAge: 1000 * 60 * 5 });

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
    this.app.post(this.urlManager.getDynamicUrl('card-clicked'), (request: Request, response: Response) => {
      void this.handleCardClicked(request, response);
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
    this.app.post(this.urlManager.getDynamicUrl('report-card'), (request: Request, response: Response) => {
      void this.handleReportCard(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('post-card-comment'), (request: Request, response: Response) => {
      void this.handlePostCardComment(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-card-comments'), (request: Request, response: Response) => {
      void this.handleGetCardComments(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-comments'), (request: Request, response: Response) => {
      void this.handleAdminGetComments(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-set-comment-curation'), (request: Request, response: Response) => {
      void this.handleAdminSetCommentCuration(request, response);
    });
  }

  async initialize2(): Promise<void> {
    const lastMutation = await db.findLastMutationByIndex();
    if (lastMutation) {
      this.lastMutationIndexSent = lastMutation.index;
    }

    // let cursor = db.getCardsMissingSearchText();
    // while (await cursor.hasNext()) {
    //   const card = await cursor.next();
    //   console.log("Card.initialize2: Adding missing searchText field in card", card.id);
    //   const state = await this.populateCardState(null, card.id, true, false);
    //   let searchText;
    //   if (state && state.state.shared) {
    //     searchText = this.searchTextFromSharedStateInfo(state.state.shared);
    //   } else {
    //     errorManager.warning("Card.initialize2: No shared state to use for search text", null);
    //   }
    //   await db.updateCardSearchText(card.id, searchText);
    // }
    // await cursor.close();

    // cursor = db.getCardsMissingBy();
    // while (await cursor.hasNext()) {
    //   const card = await cursor.next();
    //   const owner = await userManager.getUser(card.createdById, false);
    //   if (owner) {
    //     console.log("User.initialize2: Re-adding 'by' address/handle/name to user entry", owner.identity.handle);
    //     await db.updateCardBy(card.id, owner.address, owner.identity.handle, owner.identity.name);
    //   }
    // }

    // cursor = db.getCardsMissingCreatedById();
    // while (await cursor.hasNext()) {
    //   const card = await cursor.next();
    //   console.log("Card.initialize2: Replacing by.id with createdById", card.id);
    //   await db.replaceCardBy(card.id, card.by.id);
    // }
    // await cursor.close();

    // cursor = db.getCardsWithSummaryImageUrl();
    // const baseFileUrl = this.urlManager.getAbsoluteUrl('/');
    // while (await cursor.hasNext()) {
    //   const card = await cursor.next();
    //   const imageUrl = card.summary.imageUrl;
    //   if (imageUrl && imageUrl.indexOf(baseFileUrl) === 0) {
    //     console.log("Card.initialize2: Replacing summary.imageUrl with imageId", card.id);
    //     const fileId = imageUrl.substr(baseFileUrl.length).split('/')[0];
    //     if (/^[0-9a-z\-]{36}$/i.test(fileId)) {
    //       if (card.summary.imageWidth && card.summary.imageHeight) {
    //         const imageInfo: ImageInfo = {
    //           width: card.summary.imageWidth,
    //           height: card.summary.imageHeight
    //         };
    //         await db.updateFileImageInfo(fileId, imageInfo);
    //       }
    //       await db.replaceCardSummaryImageUrl(card.id, fileId);
    //     } else {
    //       console.log("Card.initialize2: Card imageUrl is not in GUID format so not updated", imageUrl, card.id);
    //     }
    //   } else {
    //     console.log("Card.initialize2: Card imageUrl is not in canonical format so not updated", imageUrl, card.id);
    //   }
    // }
    // await cursor.close();

    // Migration if there are userCardAction records for authorId and "pay" actions that don't have details filled in
    // const paymentCursor = db.getUserCardPayActionsWithoutAuthor();
    // while (await paymentCursor.hasNext()) {
    //   const userCardAction = await paymentCursor.next();
    //   const card = await this.getCardById(userCardAction.cardId, false);
    //   if (card) {
    //     const authorId = card.createdById;
    //     const transaction = await db.findBankTransactionForCardPayment(userCardAction.userId, userCardAction.cardId);
    //     if (transaction) {
    //       const paymentInfo: UserCardActionPaymentInfo = {
    //         amount: transaction.details.amount,
    //         transactionId: transaction.id,
    //         category: "normal",
    //         weight: 1,
    //         weightedRevenue: transaction.details.amount
    //       };
    //       let firstTimePaidOpens = 0;
    //       let fanPaidOpens = 0;
    //       const grossRevenue = transaction.details.amount;
    //       if (transaction.details.amount === 0.000001) {
    //         paymentInfo.category = "fraud";
    //         paymentInfo.weight = 0;
    //       } else {
    //         const priorPurchases = await db.countUserCardsPaidInTimeframe(userCardAction.userId, 0, userCardAction.at - 1);
    //         if (priorPurchases === 0) {
    //           paymentInfo.category = "first";
    //           firstTimePaidOpens++;
    //           paymentInfo.weight = this.getPurchaseWeight(0);
    //         } else {
    //           const priorToAuthor = await db.countUserCardPurchasesToAuthor(userCardAction.userId, authorId);
    //           if (priorToAuthor > 0) {
    //             paymentInfo.category = "fan";
    //             fanPaidOpens++;
    //           } else {
    //             paymentInfo.weight = this.getPurchaseWeight(priorPurchases);
    //           }
    //         }
    //       }
    //       paymentInfo.weightedRevenue = grossRevenue * paymentInfo.weight;
    //       await db.updateUserCardActionWithPaymentInfo(userCardAction.id, authorId, paymentInfo);
    //       await db.updateNetworkCardStatsForPayment(userCardAction.at, firstTimePaidOpens, fanPaidOpens, grossRevenue, paymentInfo.weightedRevenue);
    //       console.log("CardManager.initialize2: Updated userCardAction with payment information", userCardAction.id, paymentInfo.category);
    //     } else {
    //       console.warn("CardManager.initialize2: Found userCard pay action with missing transaction", userCardAction);
    //     }
    //   }
    // }
    // await paymentCursor.close();

    // const paymentCursor = await db.getWeightedUserActionPayments();
    // while (await paymentCursor.hasNext()) {
    //   const userAction = await paymentCursor.next();
    //   if (userAction.payment && userAction.payment.weightedRevenue !== userAction.payment.amount * userAction.payment.weight) {
    //     await db.updateUserActionPaymentWeightedRevenue(userAction.id, userAction.payment.amount * userAction.payment.weight);
    //     console.log("Card.initialize2: Updated user action payment weighted revenue", userAction.id, userAction.payment.amount * userAction.payment.weight);
    //   }
    // }
    // await paymentCursor.close();

    setInterval(this.poll.bind(this), 1000 * 60 * 5);
  }

  private async poll(): Promise<void> {
    const cursor = db.getUsersWithCommentNotificationPending();
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      await this.processUserForCommentNotifications(user);
    }
    await cursor.close();
  }

  private async processUserForCommentNotifications(user: UserRecord): Promise<void> {
    if (user.notifications && user.notifications.disallowCommentNotifications) {
      console.log("Card.processUserForCommentNotifications: Skipping notification because of user preference", user.id, user.identity);
      await db.updateUserCommentNotificationPending(user, false);
      return;
    }
    const now = Date.now();
    if (user.notifications && now - user.notifications.lastCommentNotification < MINIMUM_COMMENT_NOTIFICATION_INTERVAL) {
      return;
    }
    const locked = await db.updateUserCommentsLastReviewed(user.id, user.commentsLastReviewed, now);
    if (!locked) {
      console.log("Card.processUserForCommentNotifications: race condition -- skipping", user.id);
      return;
    }
    await db.updateUserCommentNotificationPending(user, false);
    if (user.curation === 'blocked') {
      console.log("Card.processUserForCommentNotifications: skipping because user is blocked", user.identity);
      return;
    }
    if (!user.identity || !user.identity.emailAddress || !user.identity.emailConfirmed) {
      console.log("Card.processUserForCommentNotifications: Skipping notification because no confirmed email", user.id, user.identity);
      return;
    }
    const userCardCursor = db.getUserCardsWithPendingCommentNotifications(user.id);
    let authorCount = 0;
    let readerCount = 0;
    const messages: string[] = [];
    const textMessages: string[] = [];
    let subject: string;
    while (await userCardCursor.hasNext()) {
      const userCard = await userCardCursor.next();
      await db.updateUserCardCommentNotificationPending(user.id, userCard.cardId, false);
      // We're looking for comments that were added after the last time the user was notified, but also
      // later than the last time the user saw those comments on screen.
      const comments = await this.findCardCommentsForCard(user, userCard.cardId, 0, Math.max(userCard.lastCommentsFetch, user.notifications && user.notifications.lastCommentNotification ? user.notifications.lastCommentNotification : 0), 64);
      if (comments.length > 0) {
        const card = await db.findCardById(userCard.cardId, false);
        if (card) {
          let count = 0;
          let commentorName = "someone";
          for (const comment of comments) {
            if (comment.byId !== user.id) {
              if (count === 0) {
                const commentor = await userManager.getUser(comment.byId, false);
                if (commentor && commentor.identity) {
                  commentorName = commentor.identity.name;
                }
              }
              count++;
            }
          }
          if (count > 0) {
            const cardUrl = this.urlManager.getAbsoluteUrl('/c/' + card.id);
            if (card.createdById === user.id) {
              authorCount++;
              let message = count > 1 ? count + " new comments" : count + " new comment from " + commentorName;
              message += ' on your card: <a href="' + cardUrl + '">"' + escapeHtml(Utils.truncate(card.summary.title, 64, true)) + '"</a>';
              messages.push(message);
              textMessages.push('New comments on your card, "' + Utils.truncate(card.summary.title, 64, true) + '"');
            } else {
              readerCount++;
              let message = count > 1 ? count + " new comments" : count + " new comment from " + commentorName;
              message += ' on a card that you commented on: <a href="' + cardUrl + '">"' + escapeHtml(Utils.truncate(card.summary.title, 64, true)) + '"</a>';
              messages.push(message);
              textMessages.push('New comments on card you commented on: "' + Utils.truncate(card.summary.title, 64, true) + '"');
            }
            if (!subject) {
              subject = 'New comments on "' + Utils.truncate(card.summary.title, 64, true) + '"';
            }
          }
        }
      }
    }
    if (messages.length > 0) {
      if (messages.length > 1) {
        subject += " and more";
      }
      console.log("Card.processUserForCommentNotifications: Sending notification email to " + user.identity.emailAddress);
      await db.updateUserCommentNotification(user);
      const body = await this.generateCommentEmail(user, messages);
      const button: EmailButton = {
        caption: "Visit Channels",
        url: this.urlManager.getAbsoluteUrl("/")
      };
      const info = {
        messages: body,
        textMessages: textMessages.join('\n')
      };
      await emailManager.sendUsingTemplate("Channels.cc", "no-reply@channels.cc", user.identity.name, user.identity.emailAddress, subject, "comment-notification", info, [button]);
    }
    await userCardCursor.close();
  }

  private async findCardCommentsForCard(user: UserRecord, cardId: string, before: number, since: number, maxCount: number): Promise<CardCommentRecord[]> {
    const cursor = db.getCardCommentsForCard(cardId, before, since, user.id);
    const results: CardCommentRecord[] = [];
    if (!maxCount) {
      maxCount = 10;
    }
    while (await cursor.hasNext()) {
      const comment = await cursor.next();
      if (comment.byId === user.id) {
        results.push(comment);
      } else {
        const commentor = await userManager.getUser(comment.byId, false);
        if (commentor.curation !== 'blocked') {
          results.push(comment);
        }
      }
      if (results.length >= maxCount) {
        break;
      }
    }
    await cursor.close();
    return results;
  }

  private async generateCommentEmail(user: UserRecord, messages: string[]): Promise<string> {
    let result = "";
    for (const message of messages) {
      result += '<div style="font-family:sans-serif;margin:15px 0;color:black;">' + message + '</div>\n';
    }
    return result;
  }

  private async getCardById(id: string, force: boolean): Promise<CardRecord> {
    let record = this.cardCache.get(id);
    if (!record || force) {
      record = await db.findCardById(id, true, false);
      this.cardCache.set(id, record);
    }
    return record;
  }

  private async handleCardRequest(request: Request, response: Response): Promise<void> {
    console.log("Card.handleCardRequest: card requested", request.params);
    let card = await db.findCardById(request.params.cardId, false, true);
    if (card && card.curation && card.curation.block) {
      card = null;
    }
    const author = card ? await userManager.getUser(card.createdById, false) : null;
    await rootPageManager.handlePage("index", request, response, card, null, author);
  }

  private async handleGetCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      const author = await userManager.getUser(card.createdById, false);
      if (!author) {
        response.status(404).send("No matching author for this card");
        return;
      }
      if (card.curation && card.curation.block && user.id !== author.id) {
        console.log("Card.handleGetCard: returning 404 for card by blocked card being requested by someone else", card.id, user.id, author.id);
        response.status(404).send("No card found");
        return;
      }
      console.log("CardManager.get-card", requestBody.detailsObject);
      const cardState = await this.populateCardState(request, card.id, true, false, null, null, null, user);
      if (!cardState) {
        response.status(404).send("Missing card state");
        return;
      }
      let delay = DEFAULT_CARD_PAYMENT_DELAY;
      if (cardState.pricing.openFeeUnits > 1 && user.firstCardPurchasedId) {
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
          errorManager.warning("Card.handleGetCard: imposing extra delay penalty", request, delay);
        }
      }
      let promotedCard: CardDescriptor;
      if (requestBody.detailsObject.includePromotedCard && !cardState.promoted) {
        promotedCard = await feedManager.getOnePromotedCardIfAppropriate(request, user, cardState, requestBody.detailsObject.channelIdContext);
      }
      const reply: GetCardResponse = {
        serverVersion: SERVER_VERSION,
        card: cardState,
        paymentDelayMsecs: delay,
        promotedCard: promotedCard,
        totalComments: 0,
        comments: [],
        commentorInfoById: {}
      };
      if (requestBody.detailsObject.maxComments) {
        reply.totalComments = await db.countCardComments(card.id, user.id);
        const cardComments = await this.findCardCommentsForCard(user, card.id, 0, 0, requestBody.detailsObject.maxComments);
        for (const cardComment of cardComments) {
          reply.comments.push(await this.populateCardComment(request, user, cardComment, reply.commentorInfoById));
        }
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetCard: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async populateCardComment(request: Request, user: UserRecord, cardComment: CardCommentRecord, commentorInfoById: { [id: string]: CommentorInfo }): Promise<CardCommentDescriptor> {
    const result: CardCommentDescriptor = {
      id: cardComment.id,
      at: cardComment.at,
      cardId: cardComment.cardId,
      byId: cardComment.byId,
      text: cardComment.text,
      metadata: cardComment.metadata
    };
    if (!commentorInfoById[cardComment.byId]) {
      const commentor = await userManager.getUser(cardComment.byId, false);
      if (commentor) {
        const commentorInfo: CommentorInfo = {
          name: commentor.identity ? commentor.identity.name : null,
          handle: commentor.identity ? commentor.identity.handle : null,
          image: commentor.identity && commentor.identity.imageId ? await fileManager.getFileInfo(commentor.identity.imageId) : null
        };
        commentorInfoById[cardComment.byId] = commentorInfo;
      }
    }
    return result;
  }

  private async handlePostCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<PostCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("CardManager.post-card", requestBody.detailsObject);
      // if (!requestBody.detailsObject.text) {
      //   response.status(400).send("Invalid request: missing text");
      //   return;
      // }
      const details = requestBody.detailsObject;
      const card = await this.postCard(request, user, requestBody.detailsObject);
      const reply: PostCardResponse = {
        serverVersion: SERVER_VERSION,
        cardId: card.id
      };
      if (requestBody.detailsObject.sharedState) {
        await this.insertCardSharedState(card, requestBody.detailsObject.sharedState);
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handlePostCard: Failure", request, err);
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

  searchTextFromSharedStateInfo(sharedState: CardState): string {
    let result = this.getObjectStringRecursive(sharedState);
    if (result.length > MAX_SEARCH_STRING_LENGTH) {
      result = result.substr(0, MAX_SEARCH_STRING_LENGTH);
    }
    return result;
  }

  private getObjectStringRecursive(object: any): string {
    let result = "";
    if (!object) {
      return result;
    }
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
    if (state.files) {
      for (const fileId of Object.keys(state.files)) {
        const postedInfo = state.files[fileId];
        const fileInfo = await fileManager.getFileInfo(fileId);
        if (fileInfo) {
          await db.upsertCardFile(card.id, "shared", '', fileInfo.id, postedInfo ? postedInfo.key : null);
        }
      }
    }
  }

  private async handleCardImpression(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardImpressionDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
        author = await userManager.getUser(card.createdById, true);
        if (!author) {
          response.status(404).send("The author no longer has an account.");
          return;
        }
        if (!author.admin && author.balance < card.pricing.promotionFee) {
          response.status(402).send("The author does not have sufficient funds.");
          return;
        }
        transaction = JSON.parse(requestBody.detailsObject.transaction.objectString) as BankTransactionDetails;
        if (!userManager.isUserAddress(author, transaction.address)) {
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
        if (!userManager.isUserAddress(author, coupon.byAddress)) {
          response.status(400).send("Invalid coupon: author mismatch");
          return;
        }
        // if (coupon.amount !== card.pricing.promotionFee) {
        //   response.status(400).send("Invalid coupon: promotion fee mismatch: " + coupon.amount + " vs " + card.pricing.promotionFee);
        //   return;
        // }
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
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "impression", null, 0, null, 0, null, null, null);
      await db.updateUserCardLastImpression(user.id, card.id, now);
      let transactionResult: BankTransactionResult;
      if (transaction && author) {
        await userManager.updateUserBalance(request, user);
        await userManager.updateUserBalance(request, author);
        transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.transaction, "Card impression: " + card.id, userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint);
        await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        const budgetAvailable = author.admin || card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent + transactionResult.record.details.amount;
        card.budget.available = budgetAvailable;
        await db.updateCardBudgetUsage(card, transactionResult.record.details.amount, budgetAvailable, this.getPromotionScores(card));
        await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "redeem-promotion", null, transactionResult.record.details.amount, transactionResult.record.id, 0, null, null, null);
        await this.incrementStat(card, "promotionsPaid", transactionResult.record.details.amount, now, PROMOTIONS_PAID_SNAPSHOT_INTERVAL);
      }
      if (requestBody.detailsObject.adSlotId) {
        const adSlot = await db.findAdSlotById(requestBody.detailsObject.adSlotId);
        if (adSlot && adSlot.status === "pending") {
          await db.updateAdSlot(adSlot.id, "impression", transactionResult ? true : false);
        }
      }
      const userStatus = await userManager.getUserStatus(request, user, false);
      const reply: CardImpressionResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult ? transactionResult.record.id : null,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardImpression: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private getFromIpAddress(request: Request): string {
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
    return ipAddress;
  }

  private async handleCardOpened(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardOpenedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      await db.incrementNetworkCardStatItems(1, uniques, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "open", null, 0, null, 0, null, null, null);
      await db.updateUserCardLastOpened(user.id, card.id, now);
      if (requestBody.detailsObject.adSlotId) {
        const adSlot = await db.findAdSlotById(requestBody.detailsObject.adSlotId);
        if (adSlot && (adSlot.status === "pending" || adSlot.status === "impression")) {
          await db.updateAdSlot(adSlot.id, "opened", false);
        }
      }
      const reply: CardOpenedResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardOpened: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardClicked(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardClickedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      const now = Date.now();
      let transactionResult: BankTransactionResult;
      if (requestBody.detailsObject.transaction && requestBody.detailsObject.transaction.objectString) {
        if (card.pricing.openPayment <= 0) {
          response.status(400).send("No open payment on this card");
          return;
        }
        const info = await db.ensureUserCardInfo(user.id, card.id);
        if (info.earnedFromAuthor > 0) {
          response.status(400).send("You have already been paid for clicking on this card");
          return;
        }
        const author = await userManager.getUser(card.createdById, true);
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
        if (!userManager.isUserAddress(author, transaction.address)) {
          response.status(400).send("The transaction doesn't list the card author as the source.");
          return;
        }
        if (transaction.amount !== card.pricing.openPayment) {
          response.status(400).send("Transaction amount does not match card click payment.");
          return;
        }
        if (transaction.reason !== "card-click-payment") {
          response.status(400).send("Transaction reason must be card-click-payment.");
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
        if (!userManager.isUserAddress(author, coupon.byAddress)) {
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
        if (coupon.reason !== 'card-click-payment') {
          response.status(400).send("Invalid coupon: invalid type");
          return;
        }
        await userManager.updateUserBalance(request, user);
        await userManager.updateUserBalance(request, author);
        transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.transaction, "Card clicked: " + card.id, userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint);
        await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
        const budgetAvailable = author.admin || card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent + transactionResult.record.details.amount;
        card.budget.available = budgetAvailable;
        await db.updateCardBudgetUsage(card, transactionResult.record.details.amount, budgetAvailable, this.getPromotionScores(card));
        await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "redeem-click-payment", null, 0, null, coupon.amount, transactionResult.record.id, null, null);
        await this.incrementStat(card, "clickFeesPaid", coupon.amount, now, CLICK_FEES_PAID_SNAPSHOT_INTERVAL);
      }
      console.log("CardManager.card-clicked", requestBody.detailsObject);
      const userCard = await db.findUserCardInfo(user.id, card.id);
      let uniques = 0;
      if (!userCard || !userCard.lastClicked) {
        await this.incrementStat(card, "uniqueClicks", 1, now, UNIQUE_CLICKS_SNAPSHOT_INTERVAL);
        uniques = 1;
      }
      await this.incrementStat(card, "clicks", 1, now, CLICKS_SNAPSHOT_INTERVAL);
      await db.incrementNetworkCardStatItems(0, 0, 0, 0, 0, 0, 1, uniques, 0, 0, 0, 0, 0, 0, 0);
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "click", null, 0, null, 0, null, null, null);
      await db.updateUserCardLastClicked(user.id, card.id, now);
      if (requestBody.detailsObject.adSlotId) {
        const adSlot = await db.findAdSlotById(requestBody.detailsObject.adSlotId);
        if (adSlot && adSlot.status !== "clicked") {
          await db.updateAdSlot(adSlot.id, "clicked", transactionResult ? true : false);
        }
      }
      const status = await userManager.getUserStatus(request, user, false);
      const reply: CardClickedResponse = {
        serverVersion: SERVER_VERSION,
        status: status,
        transactionId: transactionResult && transactionResult.record ? transactionResult.record.id : null
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardClicked: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardPay(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardPayDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      if (transaction.amount <= 0) {
        response.status(400).send("Invalid transaction amount: " + transaction.amount);
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
      const author = await userManager.getUser(card.createdById, true);
      if (!author) {
        response.status(404).send("The author of this card is missing");
        return;
      }
      let authorRecipient = false;
      for (const recipient of transaction.toRecipients) {
        let recipientUser = await userManager.getUserByAddress(recipient.address);
        if (!recipientUser) {
          recipientUser = await db.findUserByHistoricalAddress(recipient.address);
        }
        if (recipientUser) {
          if (recipientUser.id === card.createdById && recipient.portion === 'remainder') {
            authorRecipient = true;
          }
          await userManager.updateUserBalance(request, recipientUser);
        } else {
          response.status(404).send("One of the recipients is missing");
        }
      }
      if (!authorRecipient) {
        response.status(400).send("The card's author is missing as a recipient with 'remainder'.");
        return;
      }
      console.log("CardManager.card-pay", requestBody.detailsObject, user.balance, transaction.amount);
      const ipAddress = this.getFromIpAddress(request);
      let skipMoneyTransfer = false;
      let discountReason: CardPaymentFraudReason;
      let paymentCategory: CardPaymentCategory = "normal";
      if (card.curation && card.curation.block) {
        skipMoneyTransfer = true;
        paymentCategory = "blocked";
      } else if (requestBody.detailsObject.fingerprint) {
        const authorRegistrationFound = await db.existsUserRegistrationByFingerprint(author.id, requestBody.detailsObject.fingerprint);
        if (authorRegistrationFound) {
          discountReason = "author-fingerprint";
          errorManager.warning("Card.payCard: Silently skipping payment because viewer IP address and fingerprint is same as author's IP address and fingerprint", request, ipAddress, requestBody.detailsObject.fingerprint);
          skipMoneyTransfer = true;
          paymentCategory = "fraud";
        } else {
          const alreadyFromThisBrowser = await db.countUserCardsPaidFromFingerprint(card.id, requestBody.detailsObject.fingerprint);
          if (alreadyFromThisBrowser > 0) {
            discountReason = "prior-payor-fingerprint";
            errorManager.warning("Card.payCard: Silently skipping payment because already purchased from this address and fingerprint", request, ipAddress, requestBody.detailsObject.fingerprint);
            skipMoneyTransfer = true;
            paymentCategory = "fraud";
          }
        }
      }
      const amount = skipMoneyTransfer ? 0.000001 : transaction.amount;
      const cardsPreviouslyPurchased = await db.countUserCardsPaid(user.id);
      const isFirstUserCardPurchase = cardsPreviouslyPurchased === 0;
      let firstTimePaidOpens = 0;
      let fanPaidOpens = 0;
      const weight = skipMoneyTransfer ? 0 : this.getPurchaseWeight(cardsPreviouslyPurchased);
      if (paymentCategory === 'normal') {
        if (isFirstUserCardPurchase) {
          paymentCategory = "first";
          firstTimePaidOpens++;
        } else {
          const isFanPurchase = (await db.countUserCardPurchasesToAuthor(user.id, author.id)) > 0;
          if (isFanPurchase) {
            paymentCategory = "fan";
            fanPaidOpens++;
          }
        }
      }
      const grossRevenue = amount;
      await userManager.updateUserBalance(request, user);
      const transactionResult = await bank.performTransfer(request, user, requestBody.detailsObject.address, requestBody.detailsObject.transaction, card.summary.title, "Card pay: " + card.id, userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint, false, false, false, skipMoneyTransfer);
      await db.updateUserCardIncrementPaidToAuthor(user.id, card.id, amount, transactionResult.record.id);
      await db.updateUserCardIncrementEarnedFromReader(card.createdById, card.id, amount, transactionResult.record.id);
      const now = Date.now();
      const paymentInfo: UserCardActionPaymentInfo = {
        amount: amount,
        transactionId: transactionResult.record.id,
        category: paymentCategory,
        weight: weight,
        weightedRevenue: weight * amount
      };
      await db.updateUserFirstCardPurchased(user.id, card.id);
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "pay", paymentInfo, 0, null, 0, null, discountReason, null);
      await this.incrementStat(card, "revenue", amount, now, REVENUE_SNAPSHOT_INTERVAL);
      await db.incrementNetworkCardStatItems(0, 0, 1, card.pricing.openFeeUnits, 0, 0, 0, 0, 0, firstTimePaidOpens, fanPaidOpens, grossRevenue, paymentInfo.weightedRevenue, 0, 0);
      const newBudgetAvailable = author.admin || (card.budget && card.budget.amount > 0 && card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent);
      if (card.budget && card.budget.available !== newBudgetAvailable) {
        card.budget.available = newBudgetAvailable;
        await db.updateCardBudgetAvailable(card, newBudgetAvailable, this.getPromotionScores(card));
      }
      const publisherSubsidy = skipMoneyTransfer ? 0 : await this.payPublisherSubsidy(user, author, card, amount, now, request);
      await db.incrementNetworkTotals(transactionResult.amountByRecipientReason["content-purchase"] + publisherSubsidy, transactionResult.amountByRecipientReason["card-developer-royalty"], 0, 0, publisherSubsidy);
      const userStatus = await userManager.getUserStatus(request, user, false);
      await feedManager.rescoreCard(card, false);
      const reply: CardPayResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        totalCardRevenue: card.stats.revenue.value,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardPay: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private getPurchaseWeight(priorPurchases: number): number {
    if (priorPurchases <= 0) {
      return 1;
    } else if (priorPurchases <= 1) {
      return 0.33;
    } else if (priorPurchases <= 2) {
      return 0.66;
    } else if (priorPurchases <= 3) {
      return 0.8;
    } else if (priorPurchases <= 4) {
      return 0.9;
    }
    return 1;
  }

  private async payPublisherSubsidy(user: UserRecord, author: UserRecord, card: CardRecord, cardPayment: number, now: number, request: Request): Promise<number> {
    return 0;
    // // if (Date.now() - card.postedAt > PUBLISHER_SUBSIDY_MAX_CARD_AGE) {
    // //   return 0;
    // // }
    // // const existingPurchases = await db.countUserCardsPaid(user.id);
    // // if (existingPurchases <= 1) {
    // //   return;
    // // }
    // const subsidyDay = await networkEntity.getPublisherSubsidies();
    // // if (!subsidyDay || subsidyDay.remainingToday <= 0) {
    // //   return 0;
    // // }
    // const statsNow = await db.ensureNetworkCardStats();
    // const yesterdaysStats = await db.getNetworkCardStatsAt(Date.now() - 1000 * 60 * 60 * 24);
    // const totalCardPurchases = (statsNow.stats.paidOpens - (statsNow.stats.blockedPaidOpens || 0)) - (yesterdaysStats.stats.paidOpens - (yesterdaysStats.stats.blockedPaidOpens || 0));
    // const amount = await this.calculateCurrentPublisherSubsidiesPerPaidOpen();
    // await db.incrementLatestPublisherSubsidyPaid(subsidyDay.dayStarting, amount);
    // const recipient: BankTransactionRecipientDirective = {
    //   address: author.address,
    //   portion: "remainder",
    //   reason: "publisher-subsidy-recipient"
    // };
    // const details: BankTransactionDetails = {
    //   address: null,
    //   fingerprint: null,
    //   timestamp: null,
    //   type: "transfer",
    //   reason: "publisher-subsidy",
    //   relatedCardId: card.id,
    //   relatedCouponId: null,
    //   amount: amount,
    //   toRecipients: [recipient]
    // };
    // const transactionResult = await networkEntity.performBankTransaction(request, details, card.summary.title, false, true);
    // await this.incrementStat(card, "revenue", amount, now, REVENUE_SNAPSHOT_INTERVAL);
    // const newBudgetAvailable = author.admin || (card.budget && card.budget.amount > 0 && card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent);
    // if (card.budget && card.budget.available !== newBudgetAvailable) {
    //   card.budget.available = newBudgetAvailable;
    //   await db.updateCardBudgetAvailable(card, newBudgetAvailable, this.getPromotionScores(card));
    // }
    // console.log("Card.payPublisherSubsidy: Paying " + amount.toFixed(3) + " based on " + totalCardPurchases + " in last 24 hours");
    // return amount;
  }

  async calculateCurrentPublisherSubsidiesPerPaidOpen(): Promise<number> {
    const statsNow = await db.ensureNetworkCardStats();
    const yesterdaysStats = await db.getNetworkCardStatsAt(Date.now() - 1000 * 60 * 60 * 24);
    const totalCardPurchases = (statsNow.stats.paidOpens - (statsNow.stats.blockedPaidOpens || 0)) - (yesterdaysStats.stats.paidOpens - (yesterdaysStats.stats.blockedPaidOpens || 0));
    const amount = Math.min(configuration.get('subsidies.coinsPerOpen', 0.50), configuration.get('subsidies.maxCoins', 150) / (totalCardPurchases || 1));
    return amount;
  }

  private async handleRedeemCardOpen(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardRedeemOpenDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      const author = await userManager.getUser(card.createdById, true);
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
      if (!userManager.isUserAddress(author, transaction.address)) {
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
      if (!userManager.isUserAddress(author, coupon.byAddress)) {
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
      await userManager.updateUserBalance(request, user);
      await userManager.updateUserBalance(request, author);
      const transactionResult = await bank.performRedemption(author, user, requestBody.detailsObject.transaction, "Card open payment: " + card.id, userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint);
      await db.updateUserCardIncrementEarnedFromAuthor(user.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      await db.updateUserCardIncrementPaidToReader(author.id, card.id, transactionResult.record.details.amount, transactionResult.record.id);
      const budgetAvailable = author.admin || card.budget.amount + (card.stats.revenue.value * card.budget.plusPercent / 100) > card.budget.spent + transactionResult.record.details.amount;
      card.budget.available = budgetAvailable;
      await db.updateCardBudgetUsage(card, transactionResult.record.details.amount, budgetAvailable, this.getPromotionScores(card));
      const now = Date.now();
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "redeem-open-payment", null, 0, null, coupon.amount, transactionResult.record.id, null, null);
      await this.incrementStat(card, "openFeesPaid", coupon.amount, now, OPEN_FEES_PAID_SNAPSHOT_INTERVAL);
      if (requestBody.detailsObject.adSlotId) {
        const adSlot = await db.findAdSlotById(requestBody.detailsObject.adSlotId);
        if (adSlot && adSlot.status !== "open-paid") {
          await db.updateAdSlot(adSlot.id, "open-paid", true);
        }
      }
      const userStatus = await userManager.getUserStatus(request, user, false);
      const reply: CardRedeemOpenResponse = {
        serverVersion: SERVER_VERSION,
        transactionId: transactionResult.record.id,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleRedeemCardOpen: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardClosed(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardClosedDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.card-closed", requestBody.detailsObject);

      const now = Date.now();
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "close", null, 0, null, 0, null, null, null);
      await db.updateUserCardLastClosed(user.id, card.id, now);
      const reply: CardClosedResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardClosed: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateCardLike(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardLikeDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      console.log("CardManager.update-card-like", requestBody.detailsObject);
      const cardInfo = await db.ensureUserCardInfo(user.id, card.id);
      if (cardInfo && requestBody.detailsObject.selection && cardInfo.like !== requestBody.detailsObject.selection) {
        if (cardInfo.like !== requestBody.detailsObject.selection) {
          const now = Date.now();
          let existingLikes = 0;
          let existingDislikes = 0;
          switch (cardInfo.like) {
            case "like":
              existingLikes++;
              break;
            case "dislike":
              existingDislikes++;
              break;
            case "none":
              break;
            default:
              throw new Error("Unhandled card info like state " + cardInfo.like);
          }
          await db.updateUserCardInfoLikeState(user.id, card.id, requestBody.detailsObject.selection);
          cardInfo.like = requestBody.detailsObject.selection;
          let action: CardActionType;
          switch (requestBody.detailsObject.selection) {
            case "like":
              action = "like";
              break;
            case "dislike":
              action = "dislike";
              break;
            default:
              action = "reset-like";
              break;
          }
          await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, action, null, 0, null, 0, null, null, null);
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
            await db.incrementNetworkCardStatItems(0, 0, 0, 0, deltaLikes, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
          }
          if (deltaDislikes !== 0) {
            await this.incrementStat(card, "dislikes", deltaDislikes, now, LIKE_DISLIKE_SNAPSHOT_INTERVAL);
            await db.incrementNetworkCardStatItems(0, 0, 0, 0, 0, deltaDislikes, 0, 0, 0, 0, 0, 0, 0, 0, 0);
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
      errorManager.error("User.handleUpdateCardLike: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateCardPrivate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardPrivateDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.createdById !== user.id) {
        response.status(403).send("Only the author is allowed to make this change.");
        return;
      }
      console.log("CardManager.update-card-private", requestBody.detailsObject);
      const cardInfo = await db.ensureUserCardInfo(user.id, card.id);
      if (card.private !== requestBody.detailsObject.private) {
        await db.updateCardPrivate(card, requestBody.detailsObject.private);
        await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, Date.now(), requestBody.detailsObject.private ? "make-private" : "make-public", null, 0, null, 0, null, null, null);
      }
      const reply: UpdateCardPrivateResponse = {
        serverVersion: SERVER_VERSION,
        newValue: requestBody.detailsObject.private
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleUpdateCardPrivate: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleDeleteCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<DeleteCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const card = await this.getRequestedCard(user, requestBody.detailsObject.cardId, response);
      if (!card) {
        return;
      }
      if (card.createdById !== user.id) {
        response.status(403).send("Only the author is allowed to delete a card.");
        return;
      }
      console.log("CardManager.delete-card", requestBody.detailsObject);
      await db.updateCardState(card, "deleted");
      await channelManager.onCardDeleted(card);
      const reply: DeleteCardResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleDeleteCard: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleCardStatHistory(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CardStatsHistoryDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      errorManager.error("User.handleCardStatHistory: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleCardStateUpdate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardStateDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      if (card.createdById !== user.id) {
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
        await db.updateCardSummary(card, summary.title, summary.text, summary.langCode, summary.linkUrl, summary.imageId, keywords);
      }
      if (requestBody.detailsObject.state) {
        await db.deleteCardProperties(card.id);
        await db.deleteCardCollections(card.id);
        await db.deleteCardCollectionItems(card.id);
        await db.deleteCardFiles(card.id);
        await this.insertCardSharedState(card, requestBody.detailsObject.state);
      }
      const reply: UpdateCardStateResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCardStateUpdate: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleCardPricingUpdate(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateCardPricingDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      if (card.createdById !== user.id) {
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
      errorManager.error("User.handleCardStateUpdate: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleAdminUpdateCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminUpdateCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
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
      await db.updateCardAdmin(card, requestBody.detailsObject.keywords, requestBody.detailsObject.blocked, requestBody.detailsObject.boost, requestBody.detailsObject.overrideReports);
      const reply: AdminUpdateCardResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminUpdateCard: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getRequestedCard(user: UserRecord, cardId: string, response: Response): Promise<CardRecord> {
    const card = await db.findCardById(cardId, false);
    if (!card) {
      response.status(404).send("This card is no longer available");
      return null;
    }
    if (card.curation && card.curation.block && card.createdById !== user.id) {
      response.status(404).send("This card is not available");
      return;
    }
    return card;
  }

  async postCard(request: Request, user: UserRecord, details: PostCardDetails): Promise<CardRecord> {
    // if (!details.text) {
    //   throw new ErrorWithStatusCode(400, "Invalid card: missing text");
    // }
    if (!details.cardType && !details.linkUrl) {
      throw new ErrorWithStatusCode(400, "You must provide a card type or a linkUrl");
    }
    this.validateCardPricing(user, details.pricing);
    details.private = details.private ? true : false;
    const componentResponse = await channelsComponentManager.ensureComponent(request, details.cardType);
    let couponId: string;
    const cardId = uuid.v4();
    if (details.pricing.coupon) {
      const couponRecord = await bank.registerCoupon(user, cardId, details.pricing.coupon);
      couponId = couponRecord.id;
    }
    const promotionScores = this.getPromotionScoresFromData(details.pricing.budget && details.pricing.budget.amount > 0, details.pricing.openFeeUnits, details.pricing.promotionFee, details.pricing.openPayment, 0, 0, 0);
    const keywords: string[] = [];
    if (details.keywords) {
      for (const keyword of details.keywords) {
        keywords.push(keyword.trim().toLowerCase());
      }
    }
    const searchText = details.searchText && details.searchText.length > 0 ? details.searchText : this.searchTextFromSharedState(details.sharedState);
    const card = await db.insertCard(user.id, user.address, user.identity.handle, user.identity.name, details.imageId, details.linkUrl, details.iframeUrl, details.title, details.text, details.langCode, details.private, details.cardType, componentResponse.channelComponent.iconUrl, componentResponse.channelComponent.developerAddress, componentResponse.channelComponent.developerFraction, details.pricing.promotionFee, details.pricing.openPayment, details.pricing.openFeeUnits, details.pricing.budget ? details.pricing.budget.amount : 0, couponId ? true : false, details.pricing.budget ? details.pricing.budget.plusPercent : 0, details.pricing.coupon, couponId, keywords, searchText, details.fileIds, user.curation && user.curation === 'blocked' ? true : false, promotionScores, cardId);
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
    await db.updateUserLastPosted(user.id, card.postedAt, card.summary.langCode);
    await channelManager.addCardToUserChannel(card, user);
    await this.announceCardPosted(card, user);
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
    return db.lockCard(cardId, CARD_LOCK_TIMEOUT, configuration.get('serverId'));
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

  private async announceCardPosted(card: CardRecord, user: UserRecord): Promise<void> {
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
        break;
    }
  }

  private async handleCardPostedNotification(notification: ChannelsServerNotification): Promise<void> {
    const addresses = socketServer.getOpenSocketAddresses();
    if (addresses.length === 0) {
      return;
    }
    const card = await db.findCardById(notification.card, false);
    if (!card) {
      errorManager.warning("CardManager.handleCardPostedNotification: missing card", null, notification);
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
    const cardDescriptor = await this.populateCardState(null, cardId, false, false, null, null, null, user);
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

  async populateCardState(request: Request, cardId: string, includeState: boolean, promoted: boolean, adSlotId: string, sourceChannelId: string, pinInfo: ChannelCardPinInfo, user?: UserRecord, includeAdmin = false): Promise<CardDescriptor> {
    const record = await cardManager.lockCard(cardId);
    if (!record) {
      return null;
    }
    const basePrice = await priceRegulator.getBaseCardFee();
    const userInfo = user ? await db.findUserCardInfo(user.id, cardId) : null;
    const packageRootUrl = await channelsComponentManager.getPackageRootUrl(request, record.cardType.package);
    if (!packageRootUrl) {
      return null;
    }
    let iconUrl: string;
    if (typeof packageRootUrl !== 'string' || typeof record.cardType.iconUrl !== 'string') {
      errorManager.warning("CardManager.populateCardState: invalid packageRoot or iconUrl", request);
    } else {
      iconUrl = url.resolve(packageRootUrl, record.cardType.iconUrl);
    }
    try {
      const image = await fileManager.getFileInfo(record.summary.imageId);
      const summary: CardSummary = {
        imageId: image ? image.id : null,
        imageInfo: image ? image.imageInfo : null,
        imageURL: image ? image.url : record.summary.imageUrl,
        linkUrl: record.summary.linkUrl,
        iframeUrl: record.summary.iframeUrl,
        title: record.summary.title,
        text: record.summary.text,
        langCode: record.summary.langCode
      };
      let channelCard: ChannelCardRecord;
      if (user && user.homeChannelId && record.createdById !== user.id) {
        channelCard = await db.findChannelCard(user.homeChannelId, record.id);
      }
      const card: CardDescriptor = {
        id: record.id,
        postedAt: record.postedAt,
        by: await userManager.getUserDescriptor(record.createdById, false),
        summary: summary,
        keywords: record.keywords,
        private: record.private,
        cardType: {
          package: record.cardType.package,
          iconUrl: fileManager.rewriteFileUrls(iconUrl),
          royaltyAddress: record.cardType.royaltyAddress,
          royaltyFraction: record.cardType.royaltyFraction
        },
        pricing: {
          promotionFee: record.pricing.promotionFee,
          openFeeUnits: record.pricing.openFeeUnits,
          openFee: record.pricing.openFeeUnits > 0 ? record.pricing.openFeeUnits * basePrice : -record.pricing.openPayment,
          discountedOpenFee: record.pricing.openFeeUnits > 0 ? (user && user.firstCardPurchasedId ? record.pricing.openFeeUnits * basePrice : FIRST_CARD_PURCHASE_AMOUNT) : -record.pricing.openPayment
        },
        promoted: promoted,
        adSlotId: adSlotId,
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
          dislikes: record.stats.dislikes.value,
          reports: record.stats.reports ? record.stats.reports.value : 0,
          refunds: record.stats.refunds ? record.stats.refunds.value : 0
        },
        score: record.score,
        userSpecific: {
          isPoster: user && record.createdById === user.id ? true : false,
          lastImpression: userInfo ? userInfo.lastImpression : 0,
          lastOpened: userInfo ? userInfo.lastOpened : 0,
          lastClosed: userInfo ? userInfo.lastClosed : 0,
          likeState: userInfo ? userInfo.like : "none",
          paidToAuthor: userInfo ? userInfo.paidToAuthor : 0,
          paidToReader: userInfo ? userInfo.paidToReader : 0,
          earnedFromAuthor: userInfo ? userInfo.earnedFromAuthor : 0,
          earnedFromReader: userInfo ? userInfo.earnedFromReader : 0,
          openFeeRefunded: userInfo ? userInfo.openFeeRefunded : false,
          addedToHomeChannel: channelCard ? true : false
        },
        blocked: (includeAdmin || user && user.admin) && record.curation && record.curation.block ? true : false,
        overrideReports: record.curation && record.curation.overrideReports ? true : false,
        reasons: [],
        sourceChannelId: sourceChannelId,
        commentCount: await db.countCardComments(cardId, user ? user.id : null)
      };
      if (pinInfo) {
        card.pinning = pinInfo;
      }
      if (card.stats.reports > 0) {
        const cardReports = await db.findUserCardActionReports(card.id, 5);
        for (const report of cardReports) {
          for (const reason of report.report.reasons) {
            if (card.reasons.indexOf(reason) < 0) {
              card.reasons.push(reason);
            }
          }
        }
      }
      if (record.curation && record.curation.boost) {
        card.boost = record.curation.boost;
      }
      if (includeState && !card.userSpecific.openFeeRefunded) {
        card.state = {
          user: {
            properties: {},
            collections: {},
            files: {}
          },
          shared: {
            properties: {},
            collections: {},
            files: {}
          },
        };
        if (user) {
          const userProperties = await db.findCardProperties(card.id, "user", user.id);
          for (const property of userProperties) {
            let value = property.value;
            if (typeof value === 'string') {
              value = fileManager.rewriteFileUrls(value as string);
            }
            card.state.user.properties[property.name] = value;
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
              card.state.user.collections[collection.collectionName].records.push(fileManager.rewriteObjectFileUrls(item.value));
            }
          }
          const userFiles = await db.findCardFiles(card.id, "user", user.id);
          for (const userFile of userFiles) {
            const fileInfo = await fileManager.getFileInfo(userFile.fileId);
            if (fileInfo) {
              const item: FileMetadata = {
                url: fileInfo.url
              };
              if (userFile.key) {
                item.key = userFile.key;
              }
              if (fileInfo.imageInfo) {
                item.image = fileInfo.imageInfo;
              }
              card.state.user.files[fileInfo.id] = item;
            }
          }
        }
      }
      if (includeState && !card.userSpecific.openFeeRefunded) {
        const sharedProperties = await db.findCardProperties(card.id, "shared", '');
        for (const property of sharedProperties) {
          let value = property.value;
          if (typeof value === 'string') {
            value = fileManager.rewriteFileUrls(value as string);
          }
          card.state.shared.properties[property.name] = value;
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
            card.state.shared.collections[collection.collectionName].records.push(fileManager.rewriteObjectFileUrls(item.value));
          }
        }
        const sharedFiles = await db.findCardFiles(card.id, "shared", '');
        for (const sharedFile of sharedFiles) {
          const fileInfo = await fileManager.getFileInfo(sharedFile.fileId);
          if (fileInfo) {
            const item: FileMetadata = {
              url: fileInfo.url
            };
            if (sharedFile.key) {
              item.key = sharedFile.key;
            }
            if (fileInfo.imageInfo) {
              item.image = fileInfo.imageInfo;
            }
            card.state.shared.files[fileInfo.id] = item;
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
    await db.updateCardScore(card, score, this.getPromotionScores(card));
  }

  getPromotionScores(card: CardRecord): CardPromotionScores {
    if (card.stats && card.stats.reports && card.stats.reports.value > 0 && (!card.curation || !card.curation.overrideReports)) {
      return { a: 0, b: 0, c: 0, d: 0, e: 0 };
    }
    return this.getPromotionScoresFromData(card.budget.available, card.pricing.openFeeUnits, card.pricing.promotionFee, card.pricing.openPayment, card.stats.uniqueImpressions.value, card.stats.uniqueOpens.value, card.curation && card.curation.promotionBoost ? card.curation.promotionBoost : 0);
  }

  private getPromotionScoresFromData(budgetAvailable: boolean, openFeeUnits: number, promotionFee: number, openPayment: number, uniqueImpressions: number, uniqueOpens: number, boost: number): CardPromotionScores {
    return {
      a: this.getPromotionScoreFromData(0.9, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens, boost),
      b: this.getPromotionScoreFromData(0.7, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens, boost),
      c: this.getPromotionScoreFromData(0.5, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens, boost),
      d: this.getPromotionScoreFromData(0.3, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens, boost),
      e: this.getPromotionScoreFromData(0.1, budgetAvailable, openFeeUnits, promotionFee, openPayment, uniqueImpressions, uniqueOpens, boost)
    };
  }

  private getPromotionScoreFromData(ratio: number, budgetAvailable: boolean, openFeeUnits: number, promotionFee: number, openPayment: number, uniqueImpressions: number, uniqueOpens: number, boost: number): number {
    if (promotionFee === 0 && openPayment === 0) {
      return 0;
    }
    if (!budgetAvailable) {
      return 0;
    }
    let openProbability = openFeeUnits > 0 ? 0.1 : 0.01;
    if (uniqueImpressions > 100) {
      openProbability = Math.max(openFeeUnits > 0 ? 0.01 : 0.001, uniqueOpens / uniqueImpressions);
    }
    // We're going to increase the openProbability as the ratio decreases (user more likely to open to earn money)
    // if the card pays based on opens
    let openBoost = 1;
    if (openPayment > 0) {
      openBoost += 4 * (1 - ratio);  // boost of 5X when budget is near zero
    }
    const revenuePotential = promotionFee + openPayment * openProbability * openBoost;
    const desireability = openProbability * 5;
    let result = ((1 - ratio) * revenuePotential) + (ratio * desireability);
    // Add a +/- 5% random factor so as to randomize promoted cards that are very similar
    const randomFactor = result * 0.1 * (Math.random() - 0.5);
    result += randomFactor + boost;
    return result;
  }

  getCardUrl(card: CardDescriptor): string {
    return this.urlManager.getAbsoluteUrl('/c/' + card.id);
  }

  async handleReportCard(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ReportCardDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.cardId) {
        response.status(400).send("Missing cardId");
        return;
      }
      if (!requestBody.detailsObject.reasons || requestBody.detailsObject.reasons.length === 0) {
        response.status(400).send("Reasons missing");
        return;
      }
      const card = await this.getCardById(requestBody.detailsObject.cardId, true);
      if (!card) {
        response.status(404).send("No such card");
        return;
      }
      console.log("CardManager.report-card", requestBody.detailsObject);
      const now = Date.now();
      let refundCompleted = false;
      let transactionId: string;
      const userCardInfo = await db.ensureUserCardInfo(user.id, card.id);
      let refunds = 0;
      if (requestBody.detailsObject.requestRefund) {
        if (card.pricing.openFeeUnits === 0) {
          response.status(400).send("This card does not have an open fee so no refund is appropriate.");
          return;
        }
        if (userCardInfo.openFeeRefunded) {
          response.status(409).send("Previously refunded");
          return;
        }
        if (userCardInfo.paidToAuthor === 0) {
          response.status(400).send("No payment was ever made that is available for refund.");
          return;
        }
        const bankTransaction = await db.findBankTransactionForCardPayment(user.id, card.id);
        if (bankTransaction) {
          await bank.refundTransaction(request, bankTransaction, "user-card-report", now);
          transactionId = bankTransaction.id;
          await db.updateUserCardInfoOpenFeeRefund(user.id, card.id, true);
          await this.incrementStat(card, "refunds", 1, now, CARD_REFUND_SNAPSHOT_INTERVAL);
          await this.incrementStat(card, "revenue", -bankTransaction.details.amount, now, REVENUE_SNAPSHOT_INTERVAL);
          refundCompleted = true;
          refunds = 1;
          user.balance += bankTransaction.details.amount;
        } else {
          errorManager.error("Bank transaction record for original payment is missing.", request, user.id, card.id);
        }
      }
      const reportInfo: UserCardActionReportInfo = {
        reasons: requestBody.detailsObject.reasons,
        comment: requestBody.detailsObject.comment,
        refundRequested: requestBody.detailsObject.requestRefund,
        refundCompleted: refundCompleted,
        transactionId: transactionId
      };
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "report", null, 0, null, 0, null, null, reportInfo);
      await this.incrementStat(card, "reports", 1, now, CARD_REPORT_SNAPSHOT_INTERVAL);
      await db.incrementNetworkCardStatItems(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, refunds);

      if (user.admin && requestBody.detailsObject.adminBlockCard) {
        console.log("Card.handleReportCard:  admin blocking card", card.id);
        await db.updateCardAdminBlocked(card, true);
      }
      if (user.admin && requestBody.detailsObject.adminBlockUser) {
        const owner = await userManager.getUser(card.createdById, false);
        if (owner) {
          console.log("Card.handleReportCard:  admin blocking card owner", card.id, owner.id, owner.identity);
          await userManager.adminBlockUser(owner);
        }
      }

      let html = "";
      html += "<p>A user has reported a card.</p>";
      html += "<p>Card: <a href='" + this.urlManager.getAbsoluteUrl('/c/' + card.id) + "'>" + card.summary.title + "</a></p>";
      html += "<p>By: " + card.by.handle + "</p>";
      html += "<p>Reasons: " + requestBody.detailsObject.reasons.join(',') + "</p>";
      html += "<p>Comment: \"" + escapeHtml(requestBody.detailsObject.comment) + "\"</p>";
      html += "<p>Refunded: " + (refundCompleted ? "yes" : "no") + "</p>";
      html += "<p>Reported by: " + (user.identity ? user.identity.handle : user.id) + "</p>";
      console.log("Card.handleReportCard:  user reported card", user.id, card.id, card.by.handle, card.summary.title, reportInfo);
      await emailManager.sendInternalNotification("Card report: " + requestBody.detailsObject.reasons.join(','), "Card reported: " + card.id, html);
      const userStatus = await userManager.getUserStatus(request, user, false);
      const reply: ReportCardResponse = {
        serverVersion: SERVER_VERSION,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleReportCard: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handlePostCardComment(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<PostCardCommentDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.cardId || !requestBody.detailsObject.text) {
        response.status(400).send("Missing cardId and/or text");
        return;
      }
      const card = await this.getCardById(requestBody.detailsObject.cardId, true);
      if (!card) {
        response.status(404).send("No such card");
        return;
      }
      if (!user.identity) {
        response.status(403).send("You must be registered");
        return;
      }
      console.log("CardManager.post-card-comment", requestBody.detailsObject);
      const now = Date.now();
      const commentRecord = await db.insertCardComment(user.id, now, card.id, requestBody.detailsObject.text, requestBody.detailsObject.metadata, user.curation === "blocked" ? "blocked" : null);
      await db.insertUserCardAction(user.id, this.getFromIpAddress(request), requestBody.detailsObject.fingerprint, card.id, card.createdById, now, "comment", null, 0, null, 0, null, null, null);
      const notificationIds: string[] = [];
      if (card.createdById !== user.id) {
        const creator = await userManager.getUser(card.createdById, false);
        if (creator && creator.identity && creator.identity.emailConfirmed && (!creator.notifications || !creator.notifications.disallowCommentNotifications)) {
          notificationIds.push(card.createdById);
        }
      }
      const comments = await this.findCardCommentsForCard(user, card.id, 0, 0, 100);
      for (const comment of comments) {
        if (comment.byId !== user.id) {
          if (notificationIds.indexOf(comment.byId) < 0) {
            const commentor = await userManager.getUser(comment.byId, false);
            if (commentor && commentor.identity && commentor.identity.emailConfirmed && (!commentor.notifications || !commentor.notifications.disallowCommentNotifications)) {
              notificationIds.push(comment.byId);
            }
          }
        }
      }
      if (notificationIds.length > 0) {
        await db.setUserCommentNotificationPending(notificationIds, true);
        await db.updateUserCardsCommentNotificationPending(notificationIds, card.id, true);
      }
      const reply: PostCardCommentResponse = {
        serverVersion: SERVER_VERSION,
        commentId: commentRecord.id
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handlePostCardComment: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleGetCardComments(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetCardCommentsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.cardId) {
        response.status(400).send("Missing cardId");
        return;
      }
      const card = await this.getCardById(requestBody.detailsObject.cardId, true);
      if (!card) {
        response.status(404).send("No such card");
        return;
      }
      console.log("CardManager.get-card-comments", requestBody.detailsObject);
      const comments = await this.findCardCommentsForCard(user, card.id, requestBody.detailsObject.before, 0, requestBody.detailsObject.maxCount);
      const count = await db.countCardComments(card.id, user.id, requestBody.detailsObject.before);
      const reply: GetCardCommentsResponse = {
        serverVersion: SERVER_VERSION,
        comments: [],
        commentorInfoById: {},
        moreAvailable: comments.length < count
      };
      for (const comment of comments) {
        reply.comments.push(await this.populateCardComment(request, user, comment, reply.commentorInfoById));
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetCardComments: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleAdminGetComments(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetCommentsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You must be an admin");
        return;
      }
      const comments = await db.findCardCommentsRecent(200);
      console.log("CardManager.admin-get-comments", requestBody.detailsObject);
      const reply: AdminGetCommentsResponse = {
        serverVersion: SERVER_VERSION,
        comments: []
      };
      for (const comment of comments) {
        const item: AdminCommentInfo = {
          comment: comment,
          by: await userManager.getUser(comment.byId, false),
          card: await this.getCardById(comment.cardId, false)
        };
        reply.comments.push(item);
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminGetComments: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async handleAdminSetCommentCuration(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminSetCommentCurationDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You must be an admin");
        return;
      }
      const comment = await db.findCardCommentById(requestBody.detailsObject.commentId);
      if (!comment) {
        response.status(404).send("No such comment");
        return;
      }
      await db.updateCardCommentCuration(comment.id, requestBody.detailsObject.curation);
      console.log("CardManager.admin-set-comment-curation", requestBody.detailsObject);
      const reply: AdminSetCommentCurationResponse = {
        serverVersion: SERVER_VERSION,
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminSetCommentCuration: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }
}

const cardManager = new CardManager();

export { cardManager };
