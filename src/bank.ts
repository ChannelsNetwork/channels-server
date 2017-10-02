import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
import { BankTransactionReason, BankTransactionRecipientDirective, BankTransactionRecord, UserRecord, BankTransactionDetails } from "./interfaces/db-records";
import { db } from "./db";
import { KeyUtils } from "./key-utils";
import { UserHelper } from "./user-helper";
import { socketServer, BankHandler } from "./socket-server";
import { ErrorWithStatusCode } from "./interfaces/error-with-code";
import { BankTransactionResult } from "./interfaces/socket-messages";

const MAXIMUM_CLOCK_SKEW = 1000 * 60 * 15;

export class Bank implements Initializable, BankHandler {

  async initialize(urlManager: UrlManager): Promise<void> {
    socketServer.registerBankHandler(this);
  }
  async initialize2(): Promise<void> {
    // noop
  }

  async performTransaction(user: UserRecord, address: string, detailsJson: string, signature: string, networkInitiated = false): Promise<BankTransactionResult> {
    if (!UserHelper.isUsersAddress(user, address)) {
      throw new ErrorWithStatusCode(403, "This address is not owned by this user");
    }
    if (!KeyUtils.verifyString(detailsJson, UserHelper.getPublicKeyForAddress(user, address), signature)) {
      throw new ErrorWithStatusCode(401, "Transaction signature is invalid");
    }
    let details: BankTransactionDetails;
    try {
      details = JSON.parse(detailsJson);
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
    if (["card-promotion", "card-open", "card-coupon-redemption", "interest", "subsidy", "grant"].indexOf(details.reason) < 0) {
      throw new ErrorWithStatusCode(400, "Invalid transaction reasons");
    }
    switch (details.reason) {
      case "card-promotion":
      case "card-open":
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
    const participantIds: string[] = [];
    participantIds.push(user.id);
    for (const recipient of details.toRecipients) {
      if (!recipient.address || !recipient.portion) {
        throw new ErrorWithStatusCode(400, "Invalid recipient: missing address or portion");
      }
      const recipientUser = await db.findUserByAddress(recipient.address);
      if (!recipientUser) {
        throw new ErrorWithStatusCode(404, "Unknown recipient address " + recipient.address);
      }
      if (participantIds.indexOf(recipientUser.id) >= 0) {
        throw new ErrorWithStatusCode(400, "Duplicate participant (originator and/or recipients)");
      }
      participantIds.push(recipientUser.id);
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
      }
    }
    if (details.amount < totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts add up to more than total");
    }
    if (remainders === 0 && details.amount !== totalNonRemainder) {
      throw new ErrorWithStatusCode(400, "Recipient amounts do not add up to total");
    }
    if (user.type === 'normal') {
      console.log("Bank.performTransaction: Debiting user account", user.id, details.amount);
    }
    await db.incrementUserBalance(user, -details.amount, user.balance > 0 ? -details.amount : 0, user.balance > 0 ? user.balance - details.amount < user.targetBalance : false, now);
    user.balance -= details.amount;
    const record = await db.insertBankTransaction(now, user.id, participantIds, details, signature);
    for (const recipient of details.toRecipients) {
      const recipientUser = await db.findUserByAddress(recipient.address);
      let creditAmount = 0;
      switch (recipient.portion) {
        case "remainder":
          creditAmount = details.amount / remainders;
          break;
        case "fraction":
          creditAmount = details.amount * recipient.amount;
          break;
        case "absolute":
          creditAmount = recipient.amount;
          break;
      }
      console.log("Bank.performTransaction: Crediting user account", recipientUser.id, creditAmount);
      await db.incrementUserBalance(recipientUser, creditAmount, creditAmount, recipientUser.balance + creditAmount < recipientUser.targetBalance, now);
    }
    const result: BankTransactionResult = {
      record: record,
      updatedBalance: user.balance,
      balanceAt: now
    };
    return result;
  }
}

const bank = new Bank();

export { bank };
