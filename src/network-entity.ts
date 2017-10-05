import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
import { configuration } from "./configuration";
import { KeyUtils, KeyInfo } from "./key-utils";
import { Signable } from "./interfaces/rest-services";
import { BankTransactionDetails, BankTransactionRecord, BankTransactionRecipientDirective } from "./interfaces/db-records";
import { db } from "./db";
import { bank } from "./bank";
import { BankTransactionResult } from "./interfaces/socket-messages";

export class NetworkEntity implements Initializable {
  private keyInfo: KeyInfo;

  async initialize(urlManager: UrlManager): Promise<void> {
    let privateKey: Uint8Array;
    const privateKeyHex = configuration.get("privateKeyHex") as string;
    if (privateKeyHex) {
      privateKey = new Buffer(privateKeyHex, 'hex');
    } else {
      console.error("WARNING: No privateKey found in configuration, so generating one for testing purposes");
      privateKey = KeyUtils.generatePrivateKey();
    }
    this.keyInfo = KeyUtils.getKeyInfo(privateKey);
  }

  async initialize2(): Promise<void> {
    const existing = await db.findNetworkUser();
    if (!existing) {
      await db.insertUser("network", this.keyInfo.address, this.keyInfo.publicKeyPem, null, "_network_", 0, 0, "network");
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
          amount: Math.min(10, user.balance),
          toRecipients: [recipient]
        };
        await db.updateUserBalance(user.id, 0);  // will be restored as part of transactions
        await this.performBankTransaction(grant);
        const interest = Math.max(user.balance - grant.amount, 0);
        if (interest > 0) {
          const interestPayment: BankTransactionDetails = {
            timestamp: null,
            address: null,
            type: "transfer",
            reason: "interest",
            amount: interest,
            toRecipients: [recipient]
          };
          await this.performBankTransaction(interestPayment);
        }
      }
    }
  }

  async performBankTransaction(details: BankTransactionDetails): Promise<BankTransactionResult> {
    details.address = this.keyInfo.address;
    details.timestamp = Date.now();
    const detailsString = JSON.stringify(details);
    const signature = KeyUtils.signString(detailsString, this.keyInfo);
    const networkUser = await db.findNetworkUser();
    return await bank.performTransaction(networkUser, this.keyInfo.address, detailsString, signature, true);
  }
}

export interface SignedResults {
  stringified: string;
  signature: string;
}

const networkEntity = new NetworkEntity();

export { networkEntity };
