import { Initializable } from "./interfaces/initializable";
import { UrlManager } from "./url-manager";
import { db } from "./db";
import { SubsidyBalanceRecord, CardOpensInfo, CardOpensRecord } from "./interfaces/db-records";

// The PriceRegulator is the entity responsible for determining the base card price and
// base card subsidy.  The base card price is calculated based on the total net network
// balance (i.e., total unspent committed advertising coins plus unspent committed subsidy payments)
// divided by the number of card "units" opened over the previous 24 hours.  The base card
// subsidy is the total net network balance divided by the total number subsidized card opens
// over the past 24 hours.

// We keep in mongo the data needed to do these rolling 24-hour calculations.  Each processor
// refers to this data once a minute to update the base prices, and then keeps those in memory.

const POLL_INTERVAL = 1000 * 15;
const SUBSIDY_CONTRIBUTION_INTERVAL = 1000 * 60;
const SUBSIDY_CONTRIBUTION_RATE = 100.00 / (1000 * 60 * 60 * 24);  // ℂ100/day for now
const SUBSIDY_CACHE_LIFETIME = 1000 * 60 * 60;
const BASE_CARD_FEE_CACHE_LIFETIME = 1000 * 60 * 60;
const CARD_OPENED_UPDATE_INTERVAL = 1000 * 60 * 60;
const BASE_CARD_FEE_PERIOD = 1000 * 60 * 60 * 24 * 3;
const SUBSIDY_PERIOD = 1000 * 60 * 60 * 24;
const MAXIMUM_BASE_CARD_FEE = 0.05;
const MINIMUM_BASE_CARD_FEE = 0.001;
const MAXIMUM_SUBSIDY_RATE = 5 / (1000 * 60 * 60 * 24 * 3);

export class PriceRegulator implements Initializable {
  private lastSubsidyRate = 0;
  private lastSubsidyRateAt = 0;
  private lastBaseCardFee = 0;
  private lastBaseCardFeeAt = 0;
  private currentCardOpensPeriodStart = 0;

  async initialize(urlManager: UrlManager): Promise<void> {
    // noop
  }

  async initialize2(): Promise<void> {
    await this.contributeSubsidies();
    await this.getBaseCardFee();
    await this.getUserSubsidyRate();
    console.log("PriceRegulator.initialize2: base card fee, subsidy rate", this.lastBaseCardFee, this.lastSubsidyRate * 1000 * 60);
    setInterval(() => {
      void this.contributeSubsidies();
    }, POLL_INTERVAL);
    await this.onCardOpened(1);
    await this.onUserSubsidyPaid(0.0000000001);
  }

  private async contributeSubsidies(): Promise<void> {
    const balance = await db.getSubsidyBalance();
    if (!balance) {
      console.error("PriceRegulator.contributeSubsidies: missing balance");
      return;
    }
    const now = Date.now();
    if (now - balance.lastContribution > SUBSIDY_CONTRIBUTION_INTERVAL) {
      const contribution = SUBSIDY_CONTRIBUTION_RATE * (now - balance.lastContribution);
      await db.incrementSubsidyContributions(balance.lastContribution, now, contribution);
    }
  }

  async getUserSubsidyRate(): Promise<number> {
    return 0;
    // const now = Date.now();
    // if (now - this.lastSubsidyRateAt > SUBSIDY_CACHE_LIFETIME) {
    //   const balance = await db.getSubsidyBalance();
    //   const usersBelowTarget = await db.countUsersbalanceBelowTarget();
    //   this.lastSubsidyRate = Math.min(MAXIMUM_SUBSIDY_RATE, balance.balance / (Math.max(usersBelowTarget, 1) * SUBSIDY_PERIOD));
    //   console.log("PriceRegulator.getUserSubsidyRate: user subsidy rate updated", this.lastSubsidyRate * 1000 * 60);
    //   this.lastSubsidyRateAt = now;
    // }
    // return this.lastSubsidyRate;
  }

  async onUserSubsidyPaid(amount: number): Promise<void> {
    await db.incrementSubsidyPayments(amount);
  }

  async getBaseCardFee(): Promise<number> {
    const now = Date.now();
    if (now - this.lastBaseCardFeeAt > BASE_CARD_FEE_CACHE_LIFETIME) {
      await this.ensureCurrentCardOpens();
      const currentCardOpens = await db.findCurrentCardOpens();
      if (currentCardOpens) {
        const pastCardOpens = await db.findFirstCardOpensBefore(now - BASE_CARD_FEE_PERIOD);
        const previousTotal = pastCardOpens ? pastCardOpens.total.units : 0;
        const balance = await db.getSubsidyBalance();  // TODO: eventually to include purchased coins, withdrawn coins and withdrawable balance total
        this.lastBaseCardFee = Math.max(MINIMUM_BASE_CARD_FEE, Math.min(MAXIMUM_BASE_CARD_FEE, balance.balance / (Math.max(1, currentCardOpens.total.units - previousTotal))));
        this.lastBaseCardFeeAt = now;
        console.log("PriceRegulator.getBaseCardFee: baseCardFee updated", this.lastBaseCardFee);
      } else {
        this.lastBaseCardFee = MINIMUM_BASE_CARD_FEE;
      }
    }
    return this.lastBaseCardFee;
  }

  async onCardOpened(units: number): Promise<void> {
    await this.ensureCurrentCardOpens();
    const additions: CardOpensInfo = {
      opens: 1,
      units: units
    };
    while (true) {
      const result = await db.incrementCardOpensData(this.currentCardOpensPeriodStart, additions);
      if (result) {
        break;
      }
      console.log("PriceRegulator: onCardOpened: collision incrementing card opens data, so resynchronizing.");
      await this.ensureCurrentCardOpens(true);
    }
  }

  private async ensureCurrentCardOpens(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.currentCardOpensPeriodStart && now - this.currentCardOpensPeriodStart < CARD_OPENED_UPDATE_INTERVAL) {
      return;
    }
    let cardOpens = await db.findCurrentCardOpens();
    if (!cardOpens) {
      // If there is no most recent record at all, we need to create the first one
      const newRecord: CardOpensRecord = {
        periodStarted: now,
        periodEnded: 0,
        thisPeriod: {
          opens: 0,
          units: 0
        },
        total: {
          opens: 0,
          units: 0
        }
      };
      console.log("PriceRegulator.ensureCurrentCardOpens: inserting first record");
      const newInserted = await db.insertCardOpens(newRecord);
      cardOpens = newInserted ? newRecord : await db.findCurrentCardOpens();
      this.currentCardOpensPeriodStart = cardOpens.periodStarted;
      return;
    }
    this.currentCardOpensPeriodStart = cardOpens.periodStarted;
    if (now - this.currentCardOpensPeriodStart < CARD_OPENED_UPDATE_INTERVAL && cardOpens.periodEnded === 0) {
      // If the current open record is still recently added, we'll keep using it
      return;
    }
    if (cardOpens.periodEnded === 0) {
      // If the period is too long, then finalize the current one.
      console.log("PriceRegulator.ensureCurrentCardOpens: finalizing current record");
      await db.finalizeCardOpensPeriod(cardOpens.periodStarted, now);
    }
    // Regardless of whether we were the one to finalize the previous record, we will still
    // try to create a new current one, and deal with collisions.
    const record: CardOpensRecord = {
      periodStarted: now,
      periodEnded: 0,
      thisPeriod: {
        opens: 0,
        units: 0
      },
      total: {
        opens: cardOpens.total.opens,
        units: cardOpens.total.units
      }
    };
    const inserted = await db.insertCardOpens(record);
    console.log("PriceRegulator.ensureCurrentCardOpens: inserting new period record");
    cardOpens = inserted ? record : await db.findCurrentCardOpens();
    this.currentCardOpensPeriodStart = cardOpens.periodStarted;
  }
}

const priceRegulator = new PriceRegulator();

export { priceRegulator };
