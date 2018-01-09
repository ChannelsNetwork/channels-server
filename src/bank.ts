import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { UrlManager } from "./url-manager";
import { BankTransactionRecord, UserRecord, BankCouponRecord, CardRecord, BankCouponDetails } from "./interfaces/db-records";
import { db } from "./db";
import { KeyUtils } from "./key-utils";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
import { BankTransactionResult } from "./interfaces/socket-messages";
import { RestServer } from "./interfaces/rest-server";
import { RestRequest, BankWithdrawDetails, BankWithdrawResponse, BankStatementDetails, BankStatementResponse, BankTransactionDetails, BankTransactionRecipientDirective, Currency, BankTransactionDetailsWithId, BankClientCheckoutDetails, BraintreeTransactionResult, BankClientCheckoutResponse, BankGenerateClientTokenResponse } from "./interfaces/rest-services";
import { RestHelper } from "./rest-helper";
import { SignedObject } from "./interfaces/signed-object";
import * as paypal from 'paypal-rest-sdk';
import { Initializable } from "./interfaces/initializable";
import { configuration } from "./configuration";
import { Utils } from "./utils";
import { networkEntity } from "./network-entity";
import { userManager } from "./user-manager";
import { emailManager } from "./email-manager";
import { SERVER_VERSION } from "./server-version";
const braintree = require('braintree');

const MAXIMUM_CLOCK_SKEW = 1000 * 60 * 15;
const MINIMUM_BALANCE_AFTER_WITHDRAWAL = 5;

export class Bank implements RestServer, Initializable {
  private app: express.Application;
  private urlManager: UrlManager;
  private paypalEnabled = false;
  private exchangeRate = 1;
  private paypalFixedPayoutFee = 0;
  private paypalVariablePayoutFraction = 0;
  private braintreeGateway: any;

  async initialize(urlManager: UrlManager): Promise<void> {
    if (configuration.get('paypal.enabled') && configuration.get('paypal.clientId') && configuration.get('paypal.secret')) {
      const mode = configuration.get('paypal.mode', "sandbox");
      paypal.configure({
        mode: mode,
        client_id: configuration.get('paypal.clientId'),
        client_secret: configuration.get('paypal.secret')
      });
      this.paypalEnabled = true;
      console.log("Bank.initialize:  Paypal operations enabled", mode);
    }
    if (configuration.get('braintree.privateKey')) {
      this.braintreeGateway = braintree.connect({
        environment: braintree.Environment[configuration.get('braintree.environment')],
        merchantId: configuration.get('braintree.merchantId'),
        publicKey: configuration.get('braintree.publicKey'),
        privateKey: configuration.get('braintree.privateKey')
      });
      console.log("Bank.initialize:  Braintree payment operations enabled", configuration.get('braintree.environment'));
    }
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.urlManager = urlManager;
    this.app = app;
    this.registerHandlers();
  }

  async initialize2(): Promise<void> {
    // noop
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('bank-withdraw'), (request: Request, response: Response) => {
      void this.handleWithdraw(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('bank-statement'), (request: Request, response: Response) => {
      void this.handleStatement(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('bank-client-token'), (request: Request, response: Response) => {
      void this.handleClientTokenRequest(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('bank-client-checkout'), (request: Request, response: Response) => {
      void this.handleClientCheckout(request, response);
    });
  }

  get withdrawalsEnabled() {
    return this.paypalEnabled;
  }

  private async handleWithdraw(request: Request, response: Response): Promise<void> {
    try {
      if (!this.paypalEnabled) {
        response.status(500).send("Paypal functions are not available.");
        return;
      }
      const requestBody = request.body as RestRequest<BankWithdrawDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      await userManager.updateUserBalance(user);
      if (!requestBody.detailsObject.transaction) {
        response.status(400).send("Missing details");
        return;
      }
      if (!KeyUtils.verifyString(requestBody.detailsObject.transaction.objectString, user.publicKey, requestBody.detailsObject.transaction.signature)) {
        response.status(401).send("Invalid details signature");
        return;
      }
      const details = JSON.parse(requestBody.detailsObject.transaction.objectString) as BankTransactionDetails;
      if (!details.amount || !details.reason || !details.type || !details.withdrawalRecipient) {
        response.status(400).send("Invalid withdrawal details:  missing fields");
        return;
      }
      if (details.amount < 1) {
        response.status(400).send("Invalid withdrawal amount.  Must be at least ℂ1.");
        return;
      }
      if (details.reason !== "withdrawal" || details.type !== 'withdrawal') {
        response.status(400).send("Invalid withdrawal type or reason.  Both must be 'withdrawal'.");
        return;
      }
      if (details.withdrawalRecipient.currency !== 'USD') {
        response.status(400).send("Unsupported currency.  We currently only support US dollars (USD).");
        return;
      }
      if (!Utils.isValidPaypalRecipient(details.withdrawalRecipient.recipientContact)) {
        response.status(400).send("Invalid recipient");
        return;
      }
      if (details.toRecipients && details.toRecipients.length > 0) {
        response.status(400).send("ToRecipients are not allowed on a withdrawal.");
        return;
      }
      if (details.withdrawalRecipient.mechanism !== 'Paypal') {
        response.status(400).send("Invalid withdrawal mechanism.  Currently we only support Paypal.");
        return;
      }
      if (user.balance - details.amount < user.minBalanceAfterWithdrawal) {
        response.status(400).send("Invalid withdrawal amount.  You must maintain a minimum balance in your account.");
        return;
      }
      console.log("Bank.bank-withdraw", details);
      const amountInUSD = Utils.floorDecimal(details.amount * this.exchangeRate, 2);
      const feeAmount = Utils.ceilDecimal(this.paypalFixedPayoutFee + amountInUSD * this.paypalVariablePayoutFraction, 2);
      const feeDescription = "USD$" + this.paypalFixedPayoutFee.toFixed(2);
      const paidAmount = amountInUSD - feeAmount;
      const now = Date.now();
      const transactionResult = await this.initiateWithdrawal(user, requestBody.detailsObject.transaction, details, feeAmount, feeDescription, paidAmount, now);

      // const note = "Your withdrawal request from your Channels balance has been accepted.";
      // let payoutResult: PaypalPayoutResponse;
      // try {
      //   payoutResult = await this.makePaypalPayout("Channels withdrawal", paidAmount, details.withdrawalRecipient.currency, details.withdrawalRecipient.recipientContact, note, transactionResult.record.id);
      // } catch (err) {
      //   await db.updateBankTransactionWithdrawalStatus(transactionResult.record.id, null, "API_FAILED", err);
      //   response.status(503).send("Paypal payout request failed");
      //   return;
      // }
      // await db.updateBankTransactionWithdrawalStatus(transactionResult.record.id, payoutResult.batch_header.payout_batch_id, payoutResult.batch_header.batch_status, null);

      const manualRecord = await db.insertManualWithdrawal(user.id, transactionResult.record.id, "pending", now, amountInUSD, details.withdrawalRecipient.recipientContact);
      let html = "<div>";
      html += "<h3>A user has made a request for a withdrawal</h3>";
      html += "<div>Manual Withdrawal ID: " + manualRecord.id + "</div>";
      html += "<div>TransactionId: " + transactionResult.record.id + "</div>";
      html += "<div>Amount: US$" + paidAmount.toFixed(2) + "</div>";
      html += "<div>Deliver to: " + details.withdrawalRecipient.recipientContact + "</div>";
      html += "<div>UserId: " + user.id + "</div>";
      if (user.identity && user.identity.handle) {
        html += "<div>Name: " + user.identity.name + "</div>";
        html += "<div>Handle: " + user.identity.handle + "</div>";
        if (user.identity.emailAddress) {
          html += "<div>email: " + user.identity.emailAddress + "</div>";
        }
        if (user.identity.location) {
          html += "<div>location: " + user.identity.location + "</div>";
        }
        if (user.identity.imageUrl) {
          html += '<div><img style="width:100px;height:auto;" src="' + user.identity.imageUrl + '"></div>';
        }
      }
      html += "</div>";
      void emailManager.sendInternalNotification("Channels Withdrawal Request", "Withdrawal requested: " + manualRecord.id, html);
      await db.incrementNetworkTotals(0, 0, 0, amountInUSD, 0);
      const userStatus = await userManager.getUserStatus(user, false);
      const reply: BankWithdrawResponse = {
        serverVersion: SERVER_VERSION,
        paidAmount: paidAmount,
        currency: details.withdrawalRecipient.currency,
        feeAmount: feeAmount,
        feeDescription: feeDescription,
        channelsReferenceId: transactionResult.record.id,
        paypalReferenceId: null, // payoutResult.batch_header.payout_batch_id,
        updateBalanceAt: now,
        updatedBalance: user.balance,
        status: userStatus
      };
      response.json(reply);
    } catch (err) {
      console.error("Bank.handleWithdraw: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
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
        serverVersion: SERVER_VERSION,
        transactions: []
      };
      for (const transaction of transactions) {
        const info: BankTransactionDetailsWithId = {
          id: transaction.id,
          deductions: transaction.deductions || 0,
          remainderShares: transaction.remainderShares || 1,
          relatedCardTitle: transaction.relatedCardTitle,
          details: transaction.details,
          isOriginator: transaction.originatorUserId === user.id,
          isRecipient: []
        };
        for (const recipientUserId of transaction.recipientUserIds) {
          info.isRecipient.push(user.id === recipientUserId);
        }
        reply.transactions.push(info);
      }
      response.json(reply);
    } catch (err) {
      console.error("Bank.handleStatement: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleClientTokenRequest(request: Request, response: Response): Promise<void> {
    try {
      if (!this.braintreeGateway) {
        response.status(502).send("Braintree payments are not configured");
        return;
      }
      await this.generateBraintreeToken(response);
    } catch (err) {
      console.error("Bank.handleClientTokenRequest: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private generateBraintreeToken(response: Response): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.braintreeGateway.clientToken.generate({}, (err: any, gatewayResponse: any) => {
        if (err) {
          reject(err);
        } else {
          const result: BankGenerateClientTokenResponse = {
            serverVersion: SERVER_VERSION,
            clientToken: gatewayResponse.clientToken
          };
          response.json(result);
          resolve();
        }
      });
    });
  }

  private async handleClientCheckout(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<BankClientCheckoutDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, response);
      if (!user) {
        return;
      }
      console.log("Bank.bank-client-checkout", requestBody.detailsObject);
      if (!requestBody.detailsObject.paymentMethodNonce) {
        response.status(400).send("Payment method nonce missing");
        return;
      }
      if (!requestBody.detailsObject.amount || requestBody.detailsObject.amount < 0) {
        response.status(400).send("Amount is missing or invalid");
        return;
      }
      if (requestBody.detailsObject.amount < 1) {
        response.status(400).send("Amount is too small");
        return;
      }
      if (requestBody.detailsObject.amount > 10000) {
        response.status(400).send("Amount exceeds maximum allowed");
        return;
      }
      const now = Date.now();
      const amount = requestBody.detailsObject.amount;
      const fees = amount * 0.029 + 0.3;
      const netAmount = amount - fees;
      const depositRecord = await db.insertBankDeposit("pending", now, user.id, amount, fees, netAmount, requestBody.detailsObject.paymentMethodNonce, now, null);
      await userManager.updateUserBalance(user);
      const transactionResponse = await this.braintreeTransaction(requestBody.detailsObject.paymentMethodNonce, amount);
      console.log("Bank.handleClientCheckout:  transaction response from Braintree", transactionResponse);
      if (transactionResponse.success) {
        const transaction: BankTransactionDetails = {
          address: null,
          timestamp: null,
          type: "deposit",
          reason: "deposit",
          relatedCardId: null,
          relatedCouponId: null,
          amount: netAmount,
          toRecipients: []
        };
        const recipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "depositor"
        };
        transaction.toRecipients.push(recipient);
        const transactionResult = await networkEntity.performBankTransaction(transaction, null, false, true);
        await db.updateBankDeposit(depositRecord.id, "completed", transactionResult.record.at, transactionResponse, transactionResult.record.id);
        await db.incrementNetworkTotals(0, 0, netAmount, 0, 0);
      } else {
        await db.updateBankDeposit(depositRecord.id, "failed", Date.now(), transactionResponse, null);
        response.json(transactionResponse);
      }
      const result: BankClientCheckoutResponse = {
        serverVersion: SERVER_VERSION,
        status: await userManager.getUserStatus(user, false),
        transactionResult: transactionResponse
      };
      response.json(result);
    } catch (err) {
      console.error("Bank.handleClientCheckout: Failure", err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private braintreeTransaction(nonce: string, amount: number): Promise<BraintreeTransactionResult> {
    return new Promise<any>((resolve, reject) => {
      this.braintreeGateway.transaction.sale({
        amount: amount.toFixed(2),
        paymentMethodNonce: nonce,
        options: {
          submitForSettlement: true
        }
      }, (err: any, result: any) => {
        if (err) {
          reject(err);
        } else {
          const transactionResult: BraintreeTransactionResult = {
            params: result.params,
            success: result.success,
            errors: [],
            transaction: result.transaction
          };
          if (!result.success) {
            transactionResult.errors = result.errors.deepErrors();
          }
          resolve(transactionResult);
        }
      });
    });
  }

  async performTransfer(user: UserRecord, address: string, signedTransaction: SignedObject, relatedCardTitle: string, networkInitiated = false, increaseTargetBalance = false, increaseWithdrawableBalance = false, forceAmountToZero = false): Promise<BankTransactionResult> {
    if (user.address !== address) {
      throw new ErrorWithStatusCode(403, "This address is not owned by this user");
    }
    if (!KeyUtils.verifyString(signedTransaction.objectString, user.publicKey, signedTransaction.signature)) {
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
    if (["transfer", "deposit"].indexOf(details.type) < 0) {
      throw new ErrorWithStatusCode(400, "Invalid transaction type");
    }
    if (["card-open-fee", "interest", "subsidy", "grant", "deposit", "publisher-subsidy"].indexOf(details.reason) < 0) {
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
    if (!networkInitiated && !user.admin && user.balance < details.amount) {
      throw new ErrorWithStatusCode(402, "Insufficient funds");
    }
    const totalAmount = forceAmountToZero ? 0.000001 : details.amount;
    let percent = 0;
    let amount = 0;
    let totalNonRemainder = 0;
    let remainders = 0;
    const participantIds: string[] = [user.id];
    const recipientUserIds: string[] = [];
    const recipientUsers: UserRecord[] = [];
    for (const recipient of details.toRecipients) {
      if (!recipient.address || !recipient.portion) {
        console.error("Bank.transfer: Missing recipient address or portion", details);
        throw new ErrorWithStatusCode(400, "Invalid recipient: missing address or portion");
      }
      let recipientUser = await db.findUserByAddress(recipient.address);
      if (!recipientUser) {
        recipientUser = await db.findUserByHistoricalAddress(recipient.address);
      }
      if (!recipientUser) {
        throw new ErrorWithStatusCode(404, "Unknown recipient address " + recipient.address);
      }
      recipientUserIds.push(recipientUser.id);
      recipientUsers.push(recipientUser);
      if (participantIds.indexOf(recipientUser.id) < 0) {
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
          totalNonRemainder += totalAmount * recipient.amount;
          break;
        case "absolute":
          if (!recipient.amount) {
            throw new ErrorWithStatusCode(400, "Invalid recipient: missing amount");
          }
          amount += forceAmountToZero ? 0 : recipient.amount;
          totalNonRemainder += forceAmountToZero ? 0 : recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
    }
    if (totalAmount < totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts add up to more than total");
    }
    if (!forceAmountToZero && remainders === 0 && details.amount !== totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts do not add up to total");
    }
    if (user.type === 'normal') {
      console.log("Bank.performTransfer: Debiting user account", details.reason, totalAmount, user.id);
    }
    const balanceBelowTarget = user.balance < 0 ? false : user.balance - totalAmount < user.targetBalance;

    // We may need to decrement withdrawable balance to make sure it is never more than your balance
    await db.incrementUserBalance(user, -totalAmount, balanceBelowTarget, now);
    let deductions = 0;
    let remainderShares = 0;
    for (const recipient of details.toRecipients) {
      let recipientUser = await db.findUserByAddress(recipient.address);
      if (!recipientUser) {
        recipientUser = await db.findUserByHistoricalAddress(recipient.address);
      }
      if (!recipientUser) {
        throw new ErrorWithStatusCode(400, "No user with recipient address " + recipient.address);
      }
      switch (recipient.portion) {
        case "remainder":
          remainderShares++;
          break;
        case "fraction":
          deductions += totalAmount * recipient.amount;
          break;
        case "absolute":
          deductions += forceAmountToZero ? 0 : recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
    }
    const record = await db.insertBankTransaction(now, user.id, participantIds, relatedCardTitle, details, recipientUserIds, signedTransaction, deductions, remainderShares, null);
    let index = 0;
    const amountByRecipientReason: { [reason: string]: number } = {};
    for (const recipient of details.toRecipients) {
      const recipientUser = recipientUsers[index++];
      let creditAmount = 0;
      switch (recipient.portion) {
        case "remainder":
          creditAmount = (totalAmount - deductions) / remainders;
          break;
        case "fraction":
          creditAmount = totalAmount * recipient.amount;
          break;
        case "absolute":
          creditAmount = forceAmountToZero ? 0 : recipient.amount;
          break;
        default:
          throw new Error("Unhandled recipient portion " + recipient.portion);
      }
      console.log("Bank.performTransfer: Crediting user account as recipient", details.reason, creditAmount, recipientUser.id);
      await db.incrementUserBalance(recipientUser, creditAmount, recipientUser.balance + creditAmount < recipientUser.targetBalance, now);
      if (recipientUser.id === user.id) {
        user.balance += creditAmount;
      }
      amountByRecipientReason[recipient.reason.toString()] = creditAmount;
    }
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: user.balance,
      balanceAt: now,
      amountByRecipientReason: amountByRecipientReason
    };
    return result;
  }

  async performRedemption(from: UserRecord, to: UserRecord, transactionObject: SignedObject, networkInitiated = false): Promise<BankTransactionResult> {
    const now = Date.now();
    if (!KeyUtils.verifyString(transactionObject.objectString, to.publicKey, transactionObject.signature)) {
      throw new ErrorWithStatusCode(403, "This transaction is not signed properly");
    }
    const transaction = JSON.parse(transactionObject.objectString) as BankTransactionDetails;
    if (transaction.address !== from.address) {
      throw new ErrorWithStatusCode(400, "Mismatched from addresses");
    }
    if (transaction.amount <= 0) {
      throw new ErrorWithStatusCode(400, "Invalid transaction amount");
    }
    if (transaction.type !== "coupon-redemption") {
      throw new ErrorWithStatusCode(400, "Invalid transaction type");
    }
    if (transaction.toRecipients.length !== 1 || !userManager.isUserAddress(to, transaction.toRecipients[0].address)) {
      throw new ErrorWithStatusCode(400, "Mismatched recipient addresses");
    }
    const coupon = await db.findBankCouponById(transaction.relatedCouponId);
    if (!coupon) {
      throw new ErrorWithStatusCode(404, "This coupon is missing or invalid");
    }
    if (!userManager.isUserAddress(from, coupon.byAddress)) {
      throw new ErrorWithStatusCode(401, "This coupon is not for a matching user.");
    }
    if (!networkInitiated && !from.admin && from.balance < coupon.amount) {
      throw new ErrorWithStatusCode(402, "Insufficient funds");
    }
    const card = await db.findCardById(coupon.cardId, false);
    if (!card) {
      throw new ErrorWithStatusCode(404, "The card associated with this coupon is no longer available");
    }
    const redeemable = await this.isCouponRedeemable(coupon, card);
    if (!redeemable && !from.admin) {
      throw new ErrorWithStatusCode(401, "This coupon's budget is exhausted");
    }
    const originalBalance = to.balance;
    const balanceBelowTarget = from.balance < 0 ? false : from.balance - coupon.amount < from.targetBalance;
    console.log("Bank.performRedemption: Debiting user account", coupon.reason, coupon.amount, from.id);
    await db.incrementUserBalance(from, -coupon.amount, balanceBelowTarget, now);
    const record = await db.insertBankTransaction(now, from.id, [to.id, from.id], card && card.summary ? card.summary.title : null, transaction, [to.id], null, 0, 1, null);
    console.log("Bank.performRedemption: Crediting user account", coupon.reason, coupon.amount, to.id);
    await db.incrementUserBalance(to, coupon.amount, to.balance + coupon.amount < to.targetBalance, now);
    await db.incrementCouponSpent(coupon.id, coupon.amount);
    const amountByRecipientReason: { [reason: string]: number } = {};
    amountByRecipientReason[transaction.toRecipients[0].reason] = coupon.amount;
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: from.id === to.id ? originalBalance : to.balance,
      balanceAt: now,
      amountByRecipientReason: amountByRecipientReason
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
    const budget = coupon.budget.amount + authorCardInfo.earnedFromReader * coupon.budget.plusPercent / 100;
    return budget > coupon.budget.spent + coupon.amount;
  }

  async registerCoupon(user: UserRecord, cardId: string, details: SignedObject): Promise<BankCouponRecord> {
    const coupon = JSON.parse(details.objectString) as BankCouponDetails;
    if (!coupon.address || !coupon.timestamp || !coupon.reason) {
      throw new ErrorWithStatusCode(400, "Coupon has missing or invalid fields");
    }
    if (coupon.address !== user.address) {
      throw new ErrorWithStatusCode(401, "The coupon address is not associated with this user");
    }
    if (!KeyUtils.verifyString(details.objectString, user.publicKey, details.signature)) {
      throw new ErrorWithStatusCode(401, "Invalid coupon signature");
    }
    if (coupon.budget.amount < 0 || coupon.amount < 0) {
      throw new ErrorWithStatusCode(400, "Coupon amount and budget amount must be greater than zero");
    }
    if (!user.admin && coupon.budget.amount > 0 && coupon.budget.amount > user.balance) {
      throw new ErrorWithStatusCode(400, "Coupon budget amount exceeds the user's balance");
    }
    if (coupon.budget.amount > 0 && coupon.amount > coupon.budget.amount) {
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

  private async makePaypalPayout(emailSubject: string, amount: number, currency: Currency, receiverEmail: string, note: string, senderItemId: string): Promise<PaypalPayoutResponse> {
    return new Promise<PaypalPayoutResponse>((resolve, reject) => {
      const senderBatchId = Math.random().toString(36).substr(9);
      const payoutData: any = {
        sender_batch_header: {
          sender_batch_id: senderBatchId,
          email_subject: emailSubject
        },
        items: [
          {
            recipient_type: "EMAIL",
            amount: {
              value: amount.toFixed(2),
              currency: currency
            },
            receiver: receiverEmail,
            note: note,
            sender_item_id: senderItemId
          }
        ]
      };
      paypal.payout.create(payoutData, false, (err: any, payout: PaypalPayoutResponse) => {
        if (err) {
          reject(err);
        } else {
          resolve(payout);
        }
      });
    });
  }

  private async initiateWithdrawal(user: UserRecord, signedWithdrawal: SignedObject, details: BankTransactionDetails, feeAmount: number, feeDescription: string, paidAmount: number, now: number): Promise<BankTransactionResult> {
    console.log("Bank.initiateWithdrawal: Debiting user account", details.amount, user.id);
    await db.incrementUserBalance(user, -details.amount, user.balance - details.amount < user.targetBalance, now);
    const record = await db.insertBankTransaction(now, user.id, [user.id], null, details, [], signedWithdrawal, 0, 1, details.withdrawalRecipient.mechanism);
    const amountByRecipientReason: { [reason: string]: number } = {};
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: user.balance,
      balanceAt: now,
      amountByRecipientReason: {}
    };
    return result;
  }

  private async updateWithdrawalStatus(transaction: BankTransactionRecord, referenceId: string, status: string, err: any): Promise<void> {
    await db.updateBankTransactionWithdrawalStatus(transaction.id, referenceId, status, err);
  }
}

const bank = new Bank();

export { bank };

// see https://developer.paypal.com/docs/api/payments.payouts-batch/
interface PaypalPayoutResponse {
  batch_header: {
    sender_batch_header: {
      sender_batch_id: string;
      email_subject: string;
    },
    payout_batch_id: string;
    batch_status: string;
  };
}
