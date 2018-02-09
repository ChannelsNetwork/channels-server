import { configuration } from "./configuration";
import { db } from './db';
import * as path from "path";
import * as moment from "moment-timezone";
import { BankTransactionRecord } from "./interfaces/db-records";

class Tools {
  async start(): Promise<void> {
    console.log("Starting tools...");
    await this.setupConfiguration();
    await db.initialize(true);
    const from = +moment([2018, 0, 1]).startOf('day');
    const to = +moment([2018, 1, 1]).startOf('day');
    await this.generateUserAccountingReport(from, to);
  }

  async generateUserAccountingReport(from: number, to: number): Promise<void> {
    const cursor = db.getUserPublishers();
    process.stdout.write("id,name,handle,email,last posted,subsidies,gross revenue,net revenue,interest,promotions paid,open fees paid,admin,blocked,notes\n");
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      if (user.added > to) {
        continue;
      }
      const cols: any[] = [];
      cols.push(user.id);
      cols.push(user.identity ? user.identity.name : "");
      cols.push(user.identity ? user.identity.handle : "");
      cols.push(user.identity ? user.identity.emailAddress : "");
      cols.push(user.lastPosted ? moment(user.lastPosted).toISOString() : "");
      let publisherSubsidies = 0;
      let grossPublisherEarnings = 0;
      let netPublisherEarnings = 0;
      let interest = 0;
      let promotionEarnings = 0;
      let transactionCursor = db.getBankTransactionsForRecipient(user.id, from, to);
      while (await transactionCursor.hasNext()) {
        const transaction = await transactionCursor.next();
        switch (transaction.details.reason) {
          case "card-promotion":
            promotionEarnings += transaction.details.amount - transaction.deductions;
            break;
          case "card-open-payment":
            promotionEarnings += transaction.details.amount - transaction.deductions;
            break;
          case "card-click-payment":
            promotionEarnings += transaction.details.amount - transaction.deductions;
            break;
          case "card-open-fee":
            grossPublisherEarnings += transaction.details.amount;
            netPublisherEarnings += transaction.details.amount - transaction.deductions;
            break;
          case "interest":
            interest += transaction.details.amount;
            break;
          case "subsidy":
            break;
          case "grant":
            break;
          case "withdrawal":
            break;
          case "deposit":
            break;
          case "publisher-subsidy":
            publisherSubsidies += transaction.details.amount;
            break;
          default:
            break;
        }
      }
      await transactionCursor.close();
      cols.push(publisherSubsidies.toFixed(2));
      cols.push(grossPublisherEarnings.toFixed(2));
      cols.push(netPublisherEarnings.toFixed(2));
      cols.push(interest.toFixed(2));

      let paidPromotions = 0;
      let paidOpens = 0;
      transactionCursor = db.getBankTransactionsForOriginator(user.id, from, to);
      while (await transactionCursor.hasNext()) {
        const transaction = await transactionCursor.next();
        switch (transaction.details.reason) {
          case "card-promotion":
            paidPromotions += transaction.details.amount;
            break;
          case "card-open-payment":
            paidPromotions += transaction.details.amount;
            break;
          case "card-click-payment":
            paidPromotions += transaction.details.amount;
            break;
          case "card-open-fee":
            paidOpens += transaction.details.amount;
            break;
          case "interest":
            break;
          case "subsidy":
            break;
          case "grant":
            break;
          case "withdrawal":
            break;
          case "deposit":
            break;
          case "publisher-subsidy":
            break;
          default:
            break;
        }
      }
      await transactionCursor.close();
      cols.push(paidPromotions.toFixed(2));
      cols.push(paidOpens.toFixed(2));
      cols.push(user.admin ? 1 : "");
      cols.push(user.curation ? user.curation : "");
      cols.push("");
      process.stdout.write(cols.join(',') + "\n");
    }
    await cursor.close();
    console.log("Report complete");
  }

  private async setupConfiguration(): Promise<void> {
    for (let i = 0; i < process.argv.length - 1; i++) {
      if (process.argv[i] === '-c') {
        await configuration.load(process.argv[i + 1]);
        return;
      }
    }
    await configuration.load(path.join(__dirname, '../config.tools.json'));
  }

}

const tools = new Tools();

void tools.start();
