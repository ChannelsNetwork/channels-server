import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
import { configuration } from "./configuration";
import { KeyUtils, KeyInfo } from "./key-utils";
import { Signable, BankTransactionRecipientDirective, BankTransactionDetails } from "./interfaces/rest-services";
import { BankTransactionRecord } from "./interfaces/db-records";
import { db } from "./db";
import { bank } from "./bank";
import { BankTransactionResult } from "./interfaces/socket-messages";
import { SignedObject } from "./interfaces/signed-object";

export class NetworkEntity implements Initializable {
  private networkEntityKeyInfo: KeyInfo;
  private networkDeveloperKeyInfo: KeyInfo;

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
      await db.insertUser("network", this.networkEntityKeyInfo.address, this.networkEntityKeyInfo.publicKeyPem, null, "_network_", 0, 0, "network");
    }
    const existingNetworkDeveloper = await db.findNetworkDeveloperUser();
    if (!existingNetworkDeveloper) {
      await db.insertUser("networkDeveloper", this.networkDeveloperKeyInfo.address, this.networkDeveloperKeyInfo.publicKeyPem, null, "_networkDeveloper_", 0, 0, "network developer");
    }
    // If there are no bank transactions in mongo yet, we need to retroactively add these
    // for the original grant and interest
    const transactionCount = await db.countBankTransactions();
    if (transactionCount === 0) {
      const users = await db.findUsersByType("normal");
      for (const user of users) {
        const recipient: BankTransactionRecipientDirective = {
          address: user.keys[0].address,
          portion: "remainder"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          type: "transfer",
          reason: "grant",
          amount: Math.max(10, user.balance),
          relatedCardId: null,
          relatedCouponId: null,
          toRecipients: [recipient]
        };
        await db.updateUserBalance(user.id, 0);  // will be restored as part of transactions
        await this.performBankTransaction(grant, null, true);
        const interest = Math.max(user.balance - grant.amount, 0);
        if (interest > 0) {
          const interestPayment: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "interest",
            amount: interest,
            relatedCardId: null,
            relatedCouponId: null,
            toRecipients: [recipient]
          };
          await this.performBankTransaction(interestPayment, null, true);
        }
      }
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

  async performBankTransaction(details: BankTransactionDetails, relatedCardTitle: string, increaseTargetBalance: boolean): Promise<BankTransactionResult> {
    details.address = this.networkEntityKeyInfo.address;
    details.timestamp = Date.now();
    const detailsString = JSON.stringify(details);
    const signature = KeyUtils.signString(detailsString, this.networkEntityKeyInfo);
    const networkUser = await db.findNetworkUser();
    const signedObject: SignedObject = {
      objectString: detailsString,
      signature: signature
    };
    return await bank.performTransfer(networkUser, this.networkEntityKeyInfo.address, signedObject, relatedCardTitle, true, increaseTargetBalance);
  }
}

const networkEntity = new NetworkEntity();

export { networkEntity };
