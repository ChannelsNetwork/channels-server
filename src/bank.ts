import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { UrlManager } from "./url-manager";
import { BankTransactionRecord, UserRecord, BankCouponRecord, CardRecord, BankCouponDetails } from "./interfaces/db-records";
import { db } from "./db";
import { KeyUtils } from "./key-utils";
import { UserHelper } from "./user-helper";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
import { BankTransactionResult } from "./interfaces/socket-messages";
import { RestServer } from "./interfaces/rest-server";
import { RestRequest, BankWithdrawDetails, BankWithdrawResponse, BankStatementDetails, BankStatementResponse, BankTransactionDetails, BankTransactionRecipientDirective } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import { SignedObject } from "./interfaces/signed-object";

const MAXIMUM_CLOCK_SKEW = 1000 * 60 * 15;

export class Bank implements RestServer {
  private app: express.Application;
  private urlManager: UrlManager;

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('bank-withdraw'), (request: Request, response: Response) => {
      void this.handleWithdraw(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('bank-statement'), (request: Request, response: Response) => {
      void this.handleStatement(request, response);
    });
  }

  private async handleWithdraw(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<BankWithdrawDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("Bank.bank-withdraw", requestBody.detailsObject);
      const reply: BankWithdrawResponse = {
      };
      response.json(reply);
    } catch (err) {
      console.error("Bank.handleWithdraw: Failure", err);
      response.status(500).send(err);
    }
  }

  private async handleStatement(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<BankStatementDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("Bank.bank-statement", requestBody.detailsObject);
      const max = requestBody.detailsObject.maxTransactions || 50;
      const transactions = await db.findBankTransactionsByParticipant(user.id, true, max);
      const reply: BankStatementResponse = {
        transactions: []
      };
      for (const transaction of transactions) {
        reply.transactions.push({
          id: transaction.id,
          deductions: transaction.deductions || 0,
          remainderShares: transaction.remainderShares || 1,
          details: transaction.details
        });
      }
      response.json(reply);
    } catch (err) {
      console.error("Bank.handleStatement: Failure", err);
      response.status(500).send(err);
    }
  }

  async performTransfer(user: UserRecord, address: string, signedTransaction: SignedObject, networkInitiated = false, increaseTargetBalance = false): Promise<BankTransactionResult> {
    if (!UserHelper.isUsersAddress(user, address)) {
      throw new ErrorWithStatusCode(403, "This address is not owned by this user");
    }
    if (!KeyUtils.verifyString(signedTransaction.objectString, UserHelper.getPublicKeyForAddress(user, address), signedTransaction.signature)) {
      throw new ErrorWithStatusCode(401, "Transaction signature is invalid");
    }
    let details: BankTransactionDetails;
    try {
      details = JSON.parse(signedTransaction.objectString);
    } catch (err) {
      throw new ErrorWithStatusCode(400, "Invalid JSON in transaction details");
    }
    const now = Date.now();
    if (Math.abs(now - details.timestamp) > MAXIMUM_CLOCK_SKEW) {
      throw new ErrorWithStatusCode(400, "Timestamp is out of date");
    }
    if (!details.type || !details.reason || !details.amount || !details.toRecipients) {
      throw new ErrorWithStatusCode(400, "Invalid details:  missing one or more fields");
    }
    if (["transfer"].indexOf(details.type) < 0) {
      throw new ErrorWithStatusCode(400, "Invalid transaction type");
    }
    if (["card-open-fee", "interest", "subsidy", "grant"].indexOf(details.reason) < 0) {
      throw new ErrorWithStatusCode(400, "Invalid transaction reasons");
    }
    switch (details.reason) {
      case "card-open-fee":
        if (!details.relatedCardId) {
          throw new ErrorWithStatusCode(400, "relatedCardId is required and missing");
        }
        break;
      default:
        break;
    }
    if (details.toRecipients.length === 0) {
      throw new ErrorWithStatusCode(400, "Missing toRecipients");
    }
    if (!networkInitiated && user.balance < details.amount) {
      throw new ErrorWithStatusCode(402, "Insufficient funds");
    }
    let percent = 0;
    let amount = 0;
    let totalNonRemainder = 0;
    let remainders = 0;
    const participantIds: string[] = [user.id];
    for (const recipient of details.toRecipients) {
      if (!recipient.address || !recipient.portion) {
        throw new ErrorWithStatusCode(400, "Invalid recipient: missing address or portion");
      }
      const recipientUser = await db.findUserByAddress(recipient.address);
      if (!recipientUser) {
        throw new ErrorWithStatusCode(404, "Unknown recipient address " + recipient.address);
      }
      if (participantIds.indexOf(recipientUser.id) === 0) {
        participantIds.push(recipientUser.id);
      }
      switch (recipient.portion) {
        case "remainder":
          remainders++;
          break;
        case "fraction":
          if (!recipient.amount) {
            throw new ErrorWithStatusCode(400, "Invalid recipient: missing amount");
          }
          percent += recipient.amount;
          totalNonRemainder += details.amount * recipient.amount;
          break;
        case "absolute":
          if (!recipient.amount) {
            throw new ErrorWithStatusCode(400, "Invalid recipient: missing amount");
          }
          amount += recipient.amount;
          totalNonRemainder += recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
    }
    if (details.amount < totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts add up to more than total");
    }
    if (remainders === 0 && details.amount !== totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts do not add up to total");
    }
    if (user.type === 'normal') {
      console.log("Bank.performTransfer: Debiting user account", details.reason, details.amount, user.id);
    }
    const balanceBelowTarget = user.balance < 0 ? false : user.balance - details.amount < user.targetBalance;
    // console.log("Bank.performTransfer", details.reason, user.id, user.balance, details.amount);
    await db.incrementUserBalance(user, -details.amount, 0, balanceBelowTarget, now);
    let deductions = 0;
    let remainderShares = 0;
    for (const recipient of details.toRecipients) {
      switch (recipient.portion) {
        case "remainder":
          remainderShares++;
          break;
        case "fraction":
          deductions += details.amount * recipient.amount;
          break;
        case "absolute":
          deductions += recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
    }
    const record = await db.insertBankTransaction(now, user.id, participantIds, details, signedTransaction, deductions, remainderShares);
    await db.updateUserCardIncrementPaid(user.id, details.relatedCardId, details.amount, record.id);
    for (const recipient of details.toRecipients) {
      const recipientUser = await db.findUserByAddress(recipient.address);
      let creditAmount = 0;
      switch (recipient.portion) {
        case "remainder":
          creditAmount = (details.amount - deductions) / remainders;
          break;
        case "fraction":
          creditAmount = details.amount * recipient.amount;
          break;
        case "absolute":
          creditAmount = recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
      console.log("Bank.performTransfer: Crediting user account as recipient", details.reason, creditAmount, recipientUser.id);
      await db.incrementUserBalance(recipientUser, creditAmount, increaseTargetBalance ? creditAmount : 0, recipientUser.balance + creditAmount < recipientUser.targetBalance, now);
      await db.updateUserCardIncrementEarned(recipientUser.id, details.relatedCardId, creditAmount, record.id);
      if (recipientUser.id === user.id) {
        user.balance += creditAmount;
      }
    }
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: user.balance,
      balanceAt: now
    };
    return result;
  }

  async performRedemption(from: UserRecord, to: UserRecord, toAddress: string, couponId: string, networkInitiated = false): Promise<BankTransactionResult> {
    const now = Date.now();
    if (!UserHelper.isUsersAddress(to, toAddress)) {
      throw new ErrorWithStatusCode(401, "This address is not owned by the recipient");
    }
    const coupon = await db.findBankCouponById(couponId);
    if (!coupon) {
      throw new ErrorWithStatusCode(401, "This coupon is missing or invalid");
    }
    if (!networkInitiated && from.balance < coupon.amount) {
      throw new ErrorWithStatusCode(402, "Insufficient funds");
    }
    const card = await db.findCardById(coupon.cardId);
    if (!card) {
      throw new ErrorWithStatusCode(404, "The card associated with this coupon is missing");
    }
    const redeemable = await this.isCouponRedeemable(coupon, card);
    if (!redeemable) {
      throw new ErrorWithStatusCode(401, "This coupon's budget is exhausted");
    }
    const transactionDetails: BankTransactionDetails = {
      address: coupon.byAddress,
      timestamp: now,
      type: "coupon-redemption",
      reason: coupon.reason,
      amount: coupon.amount,
      relatedCardId: coupon.cardId,
      relatedCouponId: coupon.id,
      toRecipients: []
    };
    const recipient: BankTransactionRecipientDirective = {
      address: toAddress,
      portion: "remainder"
    };
    const originalBalance = to.balance;
    transactionDetails.toRecipients.push(recipient);
    const balanceBelowTarget = from.balance < 0 ? false : from.balance - coupon.amount < from.targetBalance;
    console.log("Bank.performRedemption: Debiting user account", coupon.reason, coupon.amount, from.id);
    await db.incrementUserBalance(from, -coupon.amount, 0, balanceBelowTarget, now);
    const record = await db.insertBankTransaction(now, from.id, [to.id, from.id], transactionDetails, null, 0, 1);
    if (from.id !== to.id) {
      await db.updateUserCardIncrementPaid(from.id, card.id, coupon.amount, record.id);
      await db.updateUserCardIncrementEarned(to.id, card.id, coupon.amount, record.id);
    }
    console.log("Bank.performRedemption: Crediting user account", coupon.reason, coupon.amount, to.id);
    await db.incrementUserBalance(to, coupon.amount, 0, to.balance + coupon.amount < to.targetBalance, now);
    await db.incrementCouponSpent(coupon.id, coupon.amount);
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: from.id === to.id ? originalBalance : to.balance,
      balanceAt: now
    };
    return result;
  }

  private async isCouponRedeemable(coupon: BankCouponRecord, card: CardRecord): Promise<boolean> {
    if (coupon.budget.plusPercent === 0 || !coupon.cardId) {
      return coupon.budget.amount > coupon.budget.spent;
    }
    const authorCardInfo = await db.findUserCardInfo(card.by.id, card.id);
    if (!authorCardInfo) {
      return coupon.budget.amount > coupon.budget.spent;
    }
    const budget = coupon.budget.amount + authorCardInfo.earned * coupon.budget.plusPercent / 100;
    return budget > coupon.budget.spent + coupon.amount;
  }

  async registerCoupon(user: UserRecord, cardId: string, details: SignedObject): Promise<BankCouponRecord> {
    const coupon = JSON.parse(details.objectString) as BankCouponDetails;
    if (!coupon.address || !coupon.timestamp || !coupon.reason || !coupon.amount || coupon.amount <= 0 || !coupon.budget || !coupon.budget.amount || coupon.budget.amount <= 0) {
      throw new ErrorWithStatusCode(400, "Coupon has missing or invalid fields");
    }
    if (!KeyUtils.verifyString(details.objectString, UserHelper.getPublicKeyForAddress(user, coupon.address), details.signature)) {
      throw new ErrorWithStatusCode(401, "Invalid coupon signature");
    }
    if (coupon.budget.amount <= 0 && coupon.amount <= 0) {
      throw new ErrorWithStatusCode(400, "Coupon amount and budget amount must be greater than zero");
    }
    if (coupon.budget.amount > user.balance) {
      throw new ErrorWithStatusCode(400, "Coupon budget amount exceeds the user's balance");
    }
    if (coupon.amount > coupon.budget.amount) {
      throw new ErrorWithStatusCode(400, "Coupon budget is less than coupon amount");
    }
    if (coupon.budget.plusPercent) {
      if (coupon.budget.plusPercent < 0 || coupon.budget.plusPercent > 99) {
        throw new ErrorWithStatusCode(400, "Coupon budget plusPercent is invalid");
      }
      if (coupon.reason !== "card-promotion" && coupon.reason !== "card-open-payment") {
        throw new ErrorWithStatusCode(400, "Coupon budget plusPercent cannot be non-zero except for card-promotion or card-open-payment");
      }
    }
    const record = await db.insertBankCoupon(details, user.id, coupon.address, coupon.timestamp, coupon.amount, coupon.budget.amount, coupon.budget.plusPercent, coupon.reason, cardId);
    return record;
  }
}

const bank = new Bank();

export { bank };
