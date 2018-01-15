import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
import { configuration } from "./configuration";
import { KeyUtils, KeyInfo } from "./key-utils";
import { Signable, BankTransactionRecipientDirective, BankTransactionDetails, PublisherSubsidiesInfo } from "./interfaces/rest-services";
import { BankTransactionRecord } from "./interfaces/db-records";
import { db } from "./db";
import { bank } from "./bank";
import { BankTransactionResult } from "./interfaces/socket-messages";
import { SignedObject } from "./interfaces/signed-object";
import * as moment from "moment-timezone";
import { cardManager } from "./card-manager";

const PUBLISHER_SUBSIDY_MINIMUM_COINS = 101;
const PUBLISHER_SUBSIDY_MAXIMUM_COINS = 150;
const PUBLISHER_SUBSIDY_COINS_PER_OPEN = 1.00;
const PUBLISHER_SUBSIDY_RETURN_USER_BONUS = 0.25;

export class NetworkEntity implements Initializable {
  private networkEntityKeyInfo: KeyInfo;
  private networkDeveloperKeyInfo: KeyInfo;
  private publisherSubsidyMinCoins: number;
  private publisherSubsidyMaxCoins: number;
  private publisherSubsidyCoinsPerOpen: number;
  private publisherSubsidyReturnUserBonus: number;

  async initialize(urlManager: UrlManager): Promise<void> {
    let privateKey: Uint8Array;
    let privateKeyHex = configuration.get("networkEntity.privateKeyHex") as string;
    if (privateKeyHex) {
      privateKey = new Buffer(privateKeyHex, 'hex');
    } else {
      console.error("WARNING: No networkEntity.privateKey found in configuration, so generating one for testing purposes");
      privateKey = KeyUtils.generatePrivateKey();
    }
    this.networkEntityKeyInfo = KeyUtils.getKeyInfo(privateKey);
    privateKeyHex = configuration.get("networkDeveloper.privateKeyHex") as string;
    if (privateKeyHex) {
      privateKey = new Buffer(privateKeyHex, 'hex');
    } else {
      console.error("WARNING: No networkDeveloper.privateKey found in configuration, so generating one for testing purposes");
      privateKey = KeyUtils.generatePrivateKey();
    }
    this.networkDeveloperKeyInfo = KeyUtils.getKeyInfo(privateKey);
    this.publisherSubsidyMinCoins = configuration.get('subsidies.minCoins', PUBLISHER_SUBSIDY_MINIMUM_COINS);
    this.publisherSubsidyMaxCoins = configuration.get('subsidies.maxCoins', PUBLISHER_SUBSIDY_MAXIMUM_COINS);
    this.publisherSubsidyCoinsPerOpen = configuration.get('subsidies.coinsPerOpen', PUBLISHER_SUBSIDY_COINS_PER_OPEN);
    this.publisherSubsidyReturnUserBonus = configuration.get('subsidies.returnUserBonus', PUBLISHER_SUBSIDY_RETURN_USER_BONUS);
  }

  private getKeyInfo(entityName: string): KeyInfo {
    let privateKey: Uint8Array;
    const privateKeyHex = configuration.get(entityName + ".privateKeyHex") as string;
    if (privateKeyHex) {
      privateKey = new Buffer(privateKeyHex, 'hex');
    } else {
      console.error("WARNING: No " + entityName + " privateKey found in configuration, so generating one for testing purposes");
      privateKey = KeyUtils.generatePrivateKey();
    }
    return KeyUtils.getKeyInfo(privateKey);
  }

  async initialize2(): Promise<void> {
    const existingNetwork = await db.findNetworkUser();
    if (!existingNetwork) {
      await db.insertUser("network", this.networkEntityKeyInfo.address, this.networkEntityKeyInfo.publicKeyPem, null, null, "_network_", 0, 0, 0, 0, null, null, null, null, null, null, null, "network");
    }
    const existingNetworkDeveloper = await db.findNetworkDeveloperUser();
    if (!existingNetworkDeveloper) {
      await db.insertUser("networkDeveloper", this.networkDeveloperKeyInfo.address, this.networkDeveloperKeyInfo.publicKeyPem, null, null, "_networkDeveloper_", 0, 0, 0, 0, null, null, null, null, null, null, null, "network developer");
    }
    // If there are no bank transactions in mongo yet, we need to retroactively add these
    // for the original grant and interest
    const transactionCount = await db.countBankTransactions();
    if (transactionCount === 0) {
      const users = await db.findUsersByType("normal");
      for (const user of users) {
        const recipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "grant-recipient"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          fingerprint: null,
          type: "transfer",
          reason: "grant",
          amount: Math.max(5, user.balance),
          relatedCardId: null,
          relatedCouponId: null,
          toRecipients: [recipient]
        };
        await db.updateUserBalance(user.id, 0);  // will be restored as part of transactions
        await this.performBankTransaction(grant, null, true, false);
        const interest = Math.max(user.balance - grant.amount, 0);
        if (interest > 0) {
          const interestPayment: BankTransactionDetails = {
            timestamp: null,
            address: null,
            fingerprint: null,
            type: "transfer",
            reason: "interest",
            amount: interest,
            relatedCardId: null,
            relatedCouponId: null,
            toRecipients: [recipient]
          };
          await this.performBankTransaction(interestPayment, null, true, false);
        }
      }
    }
    await this.poll();
    setInterval(() => {
      void this.poll();
    }, 1000 * 60);
  }

  async getPublisherSubsidies(): Promise<PublisherSubsidiesInfo> {
    const subsidyDay = await db.findLatestPublisherSubsidyDay();
    const result: PublisherSubsidiesInfo = {
      dayStarting: subsidyDay.starting,
      remainingToday: Math.max(0, subsidyDay.totalCoins - subsidyDay.coinsPaid),
      newUserBonus: subsidyDay.coinsPerPaidOpen,
      returnUserBonus: subsidyDay.returnUserBonus || 0.25
    };
    return result;
  }

  private async poll(): Promise<void> {
    const subsidyDay = await db.findLatestPublisherSubsidyDay();
    const midnightToday = +moment().tz('America/Los_Angeles').startOf('day');
    const now = Date.now();
    const totalCoins = this.publisherSubsidyMinCoins + Math.round(Math.random() * (this.publisherSubsidyMaxCoins - this.publisherSubsidyMinCoins));
    if (!subsidyDay || midnightToday > subsidyDay.starting) {
      console.log("Network.poll: Adding new publisher subsidy day", totalCoins, this.publisherSubsidyCoinsPerOpen);
      const amount = await cardManager.calculateCurrentPublisherSubsidiesPerPaidOpen();
      await db.insertPublisherSubsidyDays(midnightToday, totalCoins, amount, this.publisherSubsidyReturnUserBonus);
    }
  }

  getOperatorTaxFraction(): number {
    return 0.03;
  }

  getOperatorAddress(): string {
    return this.networkEntityKeyInfo.address;
  }

  getNetworkDeveloperRoyaltyFraction(): number {
    return 0.05;
  }

  getNetworkDevelopeAddress(): string {
    return this.networkDeveloperKeyInfo.address;
  }

  getReferralFraction(): number {
    return 0.02;
  }

  async performBankTransaction(details: BankTransactionDetails, relatedCardTitle: string, increaseTargetBalance: boolean, increaseWithdrawableBalance: boolean): Promise<BankTransactionResult> {
    details.address = this.networkEntityKeyInfo.address;
    details.timestamp = Date.now();
    const detailsString = JSON.stringify(details);
    const signature = KeyUtils.signString(detailsString, this.networkEntityKeyInfo);
    const networkUser = await db.findNetworkUser();
    const signedObject: SignedObject = {
      objectString: detailsString,
      signature: signature
    };
    return await bank.performTransfer(networkUser, this.networkEntityKeyInfo.address, signedObject, relatedCardTitle, true, increaseTargetBalance, increaseWithdrawableBalance);
  }
}

const networkEntity = new NetworkEntity();

export { networkEntity };
