import { MongoClient, Db, Collection, Cursor, MongoClientOptions, AggregationCursor } from "mongodb";
import * as uuid from "uuid";

import { Request, Response } from 'express';
import { configuration } from "./configuration";
import { UserRecord, NetworkRecord, UserIdentity, CardRecord, FileRecord, FileStatus, CardMutationRecord, CardStateGroup, CardMutationType, CardPropertyRecord, CardCollectionItemRecord, Mutation, MutationIndexRecord, SubsidyBalanceRecord, CardOpensRecord, CardOpensInfo, BowerManagementRecord, BankTransactionRecord, UserAccountType, CardActionType, UserCardActionRecord, UserCardInfoRecord, CardLikeState, BankTransactionReason, BankCouponRecord, BankCouponDetails, CardActiveState, ManualWithdrawalState, ManualWithdrawalRecord, CardStatisticHistoryRecord, CardStatistic, CardCollectionRecord, CardPromotionScores, CardPromotionBin, UserAddressHistory, OldUserRecord, BowerPackageRecord, CardType, PublisherSubsidyDayRecord, CardTopicRecord, NetworkCardStatsHistoryRecord, NetworkCardStats, IpAddressRecord, IpAddressStatus, UserCurationType, SocialLink, ChannelRecord, ChannelSubscriptionState, ChannelUserRecord, UserRegistrationRecord, ImageInfo, CardFileRecord, ChannelCardRecord, ChannelKeywordRecord, CardPaymentFraudReason, UserCardActionPaymentInfo, AdSlotRecord, AdSlotType, AdSlotStatus, UserCardActionReportInfo, BankTransactionRefundInfo, ChannelStatus, ChannelCardState, CardCommentMetadata, CardCommentRecord, CommentCurationType, DepositRecord, DepositStatus, GeoLocation, CardCampaignStats, CardCampaignStatus, CardCampaignType, CardCampaignBudget, CardCampaignRecord, CardCampaignStatsSnapshotRecord, ShortUrlRecord, AuthorUserRecord, UserStatsRecord } from "./interfaces/db-records";
import { Utils } from "./utils";
import { BankTransactionDetails, BowerInstallResult, ChannelComponentDescriptor, AdminUserStats, AdminActiveUserStats, AdminCardStats, AdminPurchaseStats, AdminAdStats, AdminSubscriptionStats, CardCampaignInfo } from "./interfaces/rest-services";
import { SignedObject } from "./interfaces/signed-object";
import { SERVER_VERSION } from "./server-version";
import { errorManager } from "./error-manager";
import { priceRegulator } from "./price-regulator";
import * as moment from "moment-timezone";

const NETWORK_CARD_STATS_SNAPSHOT_PERIOD = 1000 * 60 * 10;
const MAX_PAYOUT_PER_BASE_FEE_PERIOD = 500;
const MAX_AUTHOR_USER_SNAPSHOT_INTERVAL = 1000 * 60 * 60;
const MAX_USER_STATS_SNAPSHOT_INTERVAL = 1000 * 60 * 60;

export class Database {
  private db: Db;
  private oldUsers: Collection;
  private users: Collection;
  private networks: Collection;
  private cards: Collection;
  private mutationIndexes: Collection;
  private mutations: Collection;
  private cardProperties: Collection;
  private cardCollections: Collection;
  private cardCollectionItems: Collection;
  private cardFiles: Collection;
  private files: Collection;
  private cardOpens: Collection;
  private subsidyBalance: Collection;
  private bowerManagement: Collection;
  private bankTransactions: Collection;
  private userCardActions: Collection;
  private userCardInfo: Collection;
  private bankCoupons: Collection;
  private manualWithdrawals: Collection;
  private cardStatsHistory: Collection;
  private bowerPackages: Collection;
  private publisherSubsidyDays: Collection;
  private cardTopics: Collection;
  private networkCardStats: Collection;
  private ipAddresses: Collection;
  private channels: Collection;
  private channelUsers: Collection;
  private channelCards: Collection;
  private userRegistrations: Collection;
  private channelKeywords: Collection;
  private adSlots: Collection;
  private cardComments: Collection;
  private deposits: Collection;
  private cardCampaigns: Collection;
  private cardCampaignStats: Collection;
  private shortUrls: Collection;
  private authorUsers: Collection;
  private userStats: Collection;

  async initialize(): Promise<void> {
    const configOptions = configuration.get('mongo.options') as MongoClientOptions;
    const options: MongoClientOptions = configOptions ? configOptions : { w: 1 };
    this.db = await MongoClient.connect(configuration.get('mongo.mongoUrl', options));
    await this.initializeNetworks();
    await this.initializeOldUsers();
    await this.initializeCards();
    await this.initializeUsers();
    await this.initializeMutationIndexes();
    await this.initializeMutations();
    await this.initializeCardProperties();
    await this.initializeCardCollections();
    await this.initializeCardCollectionItems();
    await this.initializeCardFiles();
    await this.initializeFiles();
    await this.initializeCardOpens();
    await this.initializeSubsidyBalance();
    await this.initializeBowerManagement();
    await this.initializeBankTransactions();
    await this.initializeUserCardActions();
    await this.initializeUserCardInfo();
    await this.initializeBankCoupons();
    await this.initializeManualWithdrawals();
    await this.initializeCardStatsHistory();
    await this.initializeBowerPackages();
    await this.initializePublisherSubsidyDays();
    await this.initializeCardTopics();
    await this.initializeNetworkCardStats();
    await this.initializeIpAddresses();
    await this.initializeChannels();
    await this.initializeChannelUsers();
    await this.initializeChannelCards();
    await this.initializeUserRegistrations();
    await this.initializeChannelKeywords();
    await this.initializeAdSlots();
    await this.initializeCardComments();
    await this.initializeDeposits();
    await this.initializeCardCampaigns();
    await this.initializeCardCampaignStats();
    await this.initializeShortUrls();
    await this.initializeAuthorUsers();
    await this.initializeUserStats();
  }

  private async initializeNetworks(): Promise<void> {
    this.networks = this.db.collection('networks');
    await this.networks.createIndex({ id: 1 }, { unique: true });
    const existing = await this.networks.findOne<NetworkRecord>({ id: "1" });
    if (existing) {
      await this.networks.updateMany({ totalPublisherSubsidies: { $exists: false } }, {
        $set: {
          totalPublisherSubsidies: 0
        }
      });
    } else {
      const record: NetworkRecord = {
        id: '1',
        created: Date.now(),
        mutationIndex: 1,
        totalPublisherRevenue: 0,
        totalCardDeveloperRevenue: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalPublisherSubsidies: 0,
        maxPayoutPerBaseFeePeriod: MAX_PAYOUT_PER_BASE_FEE_PERIOD,
        cardPurchaseStatsUpdated: true,
      };
      await this.networks.insert(record);
    }
  }

  private async initializeOldUsers(): Promise<void> {
    this.oldUsers = this.db.collection('users_old');
    await this.oldUsers.createIndex({ id: 1 }, { unique: true });
  }

  private async initializeUsers(): Promise<void> {
    this.users = this.db.collection('users');

    if (await this.users.indexExists("inviterCode_1")) {
      await this.users.dropIndex('inviterCode_1');
      // await this.users.updateMany({ inviterCode: { $exists: true } }, {
      //   $unset: {
      //     inviterCode: 1,
      //     inviteeCode: 1,
      //     invitationsRemaining: 1,
      //     invitationsAccepted: 1,
      //     minBalanceAfterWithdrawal: 1,
      //     targetBalance: 1
      //   }
      // });
    }

    await this.users.createIndex({ id: 1 }, { unique: true });
    await this.users.createIndex({ address: 1 }, { unique: true });
    await this.users.createIndex({ "identity.handle": 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ "identity.emailAddress": 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ type: 1, balanceLastUpdated: -1 });
    await this.users.createIndex({ type: 1, lastContact: -1 });
    await this.users.createIndex({ type: 1, lastPosted: -1 });
    await this.users.createIndex({ type: 1, balanceBelowTarget: 1 });
    await this.users.createIndex({ recoveryCode: 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ ipAddresses: 1, added: -1 });
    await this.users.createIndex({ added: -1 });
    await this.users.createIndex({ "identity.emailConfirmationCode": 1 });
    await this.users.createIndex({ commentNotificationPending: 1 });
  }

  private async initializeCards(): Promise<void> {
    this.cards = this.db.collection('cards');
    await this.cards.createIndex({ id: 1 }, { unique: true }); // findCardById
    await this.cards.createIndex({ type: 1, postedAt: -1 });  // findCardMostRecentByType
    await this.cards.createIndex({ state: 1, postedAt: 1, lastScored: -1 });  // findCardsForScoring, findCardsByTime
    await this.cards.createIndex({ state: 1, "curation.block": 1, "budget.available": 1, private: 1, postedAt: -1 }); // findCardsWithAvailableBudget
    await this.cards.createIndex({ state: 1, "curation.block": 1, private: 1, "by.name": "text", "by.handle": "text", "summary.title": "text", "summary.text": "text", searchText: "text", keywords: "text" }, { name: "textSearch", weights: { "summary.title": 4, "summary.text": 4, "keywords": 4, "by.name": 4, "by.handle": 4 } }); // findCardsBySearch
    await this.cards.createIndex({ state: 1, "curation.block": 1, createdById: 1, postedAt: -1 }); // findCardsByUserAndTime, findAccessibleCardsByTime
    await this.cards.createIndex({ state: 1, "curation.block": 1, createdById: 1, "stats.revenue.value": -1 }); // findCardsByRevenue
    await this.cards.createIndex({ state: 1, "curation.block": 1, createdById: 1, "pricing.openFeeUnits": 1, score: -1 }); // findCardsByScore
    await this.cards.createIndex({ state: 1, "curation.block": 1, private: 1, keywords: 1, score: -1 }); // findCardsUsingKeywords
    await this.cards.createIndex({ state: 1, "curation.block": 1, private: 1, "pricing.openFeeUnits": 1, postedAt: -1 });
    await this.cards.createIndex({ createdById: 1, postedAt: -1 });
  }

  private async ensureStatistic(stat: string): Promise<void> {
    const query: any = {};
    query[stat] = { $exists: false };
    const update: any = {};
    update[stat] = { value: 0, history: [] };
    await this.cards.updateMany(query, { $set: update });
  }

  private async initializeMutationIndexes(): Promise<void> {
    this.mutationIndexes = this.db.collection('mutationIndexes');
    await this.mutationIndexes.createIndex({ id: 1 }, { unique: true });
    await this.ensureMutationIndex();
  }

  private async initializeMutations(): Promise<void> {
    this.mutations = this.db.collection('mutations');
    await this.mutations.createIndex({ index: 1 }, { unique: true });
    await this.mutations.createIndex({ id: 1 }, { unique: true });
    await this.mutations.createIndex({ cardId: 1, group: 1, at: -1 });
  }

  private async initializeCardProperties(): Promise<void> {
    this.cardProperties = this.db.collection('cardProperties');
    await this.cardProperties.createIndex({ cardId: 1, group: 1, user: 1, name: 1 }, { unique: true });
  }

  private async initializeCardCollections(): Promise<void> {
    this.cardCollections = this.db.collection('cardCollections');
    await this.cardCollections.createIndex({ cardId: 1, group: 1, user: 1, collectionName: 1 }, { unique: true });
  }

  private async initializeCardCollectionItems(): Promise<void> {
    this.cardCollectionItems = this.db.collection('cardCollectionItems');
    await this.cardCollectionItems.createIndex({ cardId: 1, group: 1, user: 1, collectionName: 1, key: 1 }, { unique: true });
    await this.cardCollectionItems.createIndex({ cardId: 1, group: 1, user: 1, collectionName: 1, index: 1 }, { unique: true });
  }

  private async initializeCardFiles(): Promise<void> {
    this.cardFiles = this.db.collection('cardFiles');
    await this.cardFiles.createIndex({ cardId: 1, group: 1, user: 1, fileId: 1 }, { unique: true });
  }

  private async initializeFiles(): Promise<void> {
    this.files = this.db.collection('files');
    await this.files.createIndex({ id: 1 }, { unique: true });
  }

  private async initializeCardOpens(): Promise<void> {
    this.cardOpens = this.db.collection('cardOpens');
    await this.cardOpens.createIndex({ periodStarted: -1 }, { unique: true });
    await this.cardOpens.createIndex({ periodEnded: -1 }, { unique: true });
  }

  private async initializeSubsidyBalance(): Promise<void> {
    this.subsidyBalance = this.db.collection('subsidyBalance');
    await this.subsidyBalance.createIndex({ id: 1 }, { unique: true });
    await this.subsidyBalance.createIndex({ lastContribution: 1 });
    const count = await this.subsidyBalance.count({});
    if (count < 1) {
      const record: SubsidyBalanceRecord = {
        id: "1",
        balance: 10,
        totalContributions: 0,
        totalPayments: 0,
        lastContribution: Date.now()
      };
      try {
        await this.subsidyBalance.insertOne(record);
      } catch (err) {
        errorManager.error("Db.initializeSubsidyBalance: collision adding initial record", null);
      }
    }
  }

  private async initializeBowerManagement(): Promise<void> {
    this.bowerManagement = this.db.collection('bowerManagement');
    await this.bowerManagement.createIndex({ id: 1 }, { unique: true });
    try {
      const record: BowerManagementRecord = {
        id: 'main',
        serverId: null,
        status: 'available',
        timestamp: Date.now()
      };
      await this.bowerManagement.insert(record);
    } catch (_) {
      // noop
    }
  }

  private async initializeBankTransactions(): Promise<void> {
    this.bankTransactions = this.db.collection('bankTransactions');
    await this.bankTransactions.createIndex({ id: 1 }, { unique: true });
    await this.bankTransactions.createIndex({ originatorUserId: 1, "details.timestamp": -1 });
    await this.bankTransactions.createIndex({ participantUserIds: 1, "details.timestamp": -1 });
    await this.bankTransactions.createIndex({ "details.reason": 1, "details.timestamp": -1 });
  }

  private async initializeUserCardActions(): Promise<void> {
    this.userCardActions = this.db.collection('userCardActions');
    await this.userCardActions.createIndex({ id: 1 }, { unique: true });
    await this.userCardActions.createIndex({ userId: 1, action: 1, at: -1 });
    await this.userCardActions.createIndex({ userId: 1, action: 1, at: 1 });
    await this.userCardActions.createIndex({ userId: 1, action: 1, author: 1 });
    await this.userCardActions.createIndex({ cardId: 1, action: 1, fromIpAddress: 1, fromFingerprint: 1 });
    await this.userCardActions.createIndex({ cardId: 1, action: 1, at: -1 });
    await this.userCardActions.createIndex({ authorId: 1, action: 1, at: -1 });
    await this.userCardActions.createIndex({ action: 1, at: -1 });
    await this.userCardActions.createIndex({ at: -1 });
  }

  private async initializeUserCardInfo(): Promise<void> {
    this.userCardInfo = this.db.collection('userCardInfo');
    await this.userCardInfo.createIndex({ userId: 1, cardId: 1 }, { unique: true });
    await this.userCardInfo.createIndex({ userId: 1, lastOpened: -1 });
    await this.userCardInfo.createIndex({ userId: 1, commentNotificationPending: 1 });

    await this.userCardInfo.updateMany({ referredPurchases: { $exists: false } }, { $set: { referredPurchases: 0 } });
  }

  private async initializeBankCoupons(): Promise<void> {
    this.bankCoupons = this.db.collection('bankCoupons');
    await this.bankCoupons.createIndex({ id: 1 }, { unique: true });
    await this.bankCoupons.createIndex({ cardId: 1 });
  }

  private async initializeManualWithdrawals(): Promise<void> {
    this.manualWithdrawals = this.db.collection('manualWithdrawals');
    await this.manualWithdrawals.createIndex({ id: 1 }, { unique: true });
    await this.manualWithdrawals.createIndex({ state: 1, created: -1 });
  }

  private async initializeCardStatsHistory(): Promise<void> {
    this.cardStatsHistory = this.db.collection('cardStatsHistory');
    await this.cardStatsHistory.createIndex({ cardId: 1, statName: 1, at: -1 });
  }

  private async initializeBowerPackages(): Promise<void> {
    this.bowerPackages = this.db.collection('bowerPackages');
    await this.bowerPackages.createIndex({ packageName: 1 }, { unique: true });
  }

  private async initializePublisherSubsidyDays(): Promise<void> {
    this.publisherSubsidyDays = this.db.collection('publisherSubsidyDays');
    await this.publisherSubsidyDays.createIndex({ starting: -1 }, { unique: true });
  }

  private async initializeCardTopics(): Promise<void> {
    this.cardTopics = this.db.collection('cardTopics');
    await this.cardTopics.createIndex({ id: 1 }, { unique: true });
    await this.cardTopics.createIndex({ status: 1, topicWithCase: 1 });
    await this.cardTopics.createIndex({ topicNoCase: 1 });

    for (const item of DEFAULT_CARD_TOPICS) {
      const existing = await this.findCardTopicByName(item.topic);
      let add = false;
      if (existing) {
        for (const keyword of item.keywords) {
          if (existing.keywords.indexOf(keyword) < 0) {
            add = true;
            break;
          }
        }
        if (add) {
          await this.cardTopics.remove({ id: existing.id });
        }
      } else {
        add = true;
      }
      if (add) {
        const record: CardTopicRecord = {
          id: uuid.v4(),
          status: "active",
          topicNoCase: item.topic.toLowerCase(),
          topicWithCase: item.topic,
          keywords: this.cleanKeywords(item.keywords),
          added: Date.now()
        };
        await this.cardTopics.insert(record);
      }
    }
  }

  private async initializeNetworkCardStats(): Promise<void> {
    this.networkCardStats = this.db.collection('networkCardStats');
    await this.networkCardStats.createIndex({ periodStarting: -1 }, { unique: true });
    const existing = await this.ensureNetworkCardStats(true);
    if (existing && !existing.stats.purchases) {
      // Some of these stats were added later, so we need to initialize their values
      // based on other queries

      console.log("Db.initializeNetworkCardStats: Generating missing stats...");
      const purchaserInfo = await this.userCardActions.aggregate([
        { $match: { action: "pay", fraudReason: { $exists: false } } },
        {
          $group: {
            _id: "$userId",
            revenue: { $sum: "$payment.amount" }
          }
        },
        {
          $group: {
            _id: "all",
            count: { $sum: 1 },
            revenue: { $sum: "$revenue" }
          }
        }
      ]).toArray();
      const purchasers = purchaserInfo.length > 0 ? purchaserInfo[0].count as number : 0;
      const registrants = await this.users.count({ "identity.handle": { $exists: true } });
      const publishers = await this.users.count({ lastPosted: { $gt: 0 } });
      const purchases = await this.userCardActions.count({ action: "pay", fraudReason: { $exists: false } });
      const cards = await this.cards.count({});
      const cardPayments = purchaserInfo.length > 0 ? purchaserInfo[0].revenue as number : 0;
      await this.incrementNetworkCardStatItems(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, purchasers, registrants, publishers, purchases, cards, cardPayments, 0, 0, 0, 0, 0, 0, 0);
      console.log("Db.initializeNetworkCardStats: Done");
    }
  }

  private async initializeIpAddresses(): Promise<void> {
    this.ipAddresses = this.db.collection('ipAddresses');
    await this.ipAddresses.createIndex({ ipAddress: 1 }, { unique: true });
    await this.ipAddresses.createIndex({ countryCode: 1, region: 1 });
  }

  private async initializeChannels(): Promise<void> {
    this.channels = this.db.collection('channels');
    await this.channels.createIndex({ id: 1 }, { unique: true });
    await this.channels.createIndex({ handle: 1 }, { unique: true });
    await this.channels.createIndex({ ownerId: 1 });
    await this.channels.createIndex({ state: 1, name: "text", handle: "text", keywords: "text", about: "text" }, { name: "textSearchIndex", weights: { name: 5, handle: 5, keywords: 3, about: 1 } });
    await this.channels.createIndex({ firstCardPosted: -1 });
    await this.channels.createIndex({ state: 1, featuredWeight: -1 });
    await this.channels.createIndex({ state: 1, listingWeight: -1 });
    await this.channels.createIndex({ created: -1 });
  }

  private async initializeChannelUsers(): Promise<void> {
    this.channelUsers = this.db.collection('channelUsers');
    await this.channelUsers.createIndex({ channelId: 1, userId: 1 }, { unique: true });
    await this.channelUsers.createIndex({ userId: 1, subscriptionState: 1, lastCardPosted: -1 });
    await this.channelUsers.createIndex({ notificationPending: 1, lastCardPosted: -1 });
    await this.channelUsers.createIndex({ channelId: 1, subscriptionState: 1, lastUpdated: -1 });
  }

  private async initializeChannelCards(): Promise<void> {
    this.channelCards = this.db.collection('channelCards');
    await this.channelCards.createIndex({ channelId: 1, cardId: 1 }, { unique: true });
    await this.channelCards.createIndex({ state: 1, channelId: 1, cardId: 1 });
    await this.channelCards.createIndex({ state: 1, cardId: 1 });
    await this.channelCards.createIndex({ state: 1, channelId: 1, pinned: -1, pinPriority: -1 });
    await this.channelCards.createIndex({ state: 1, channelId: 1, pinned: 1, cardLastPosted: -1 });
    await this.channelCards.createIndex({ state: 1, channelId: 1, cardLastPosted: -1 });
  }

  private async initializeUserRegistrations(): Promise<void> {
    this.userRegistrations = this.db.collection('userRegistrations');
    await this.userRegistrations.createIndex({ userId: 1, at: -1 });
    await this.userRegistrations.createIndex({ userId: 1, ipAddress: 1, fingerprint: 1 });
    await this.userRegistrations.createIndex({ mobile: 1, userId: 1, fingerprint: 1 });
    await this.userRegistrations.createIndex({ sessionId: 1 }, { unique: true, sparse: true });
  }

  private async initializeChannelKeywords(): Promise<void> {
    this.channelKeywords = this.db.collection('channelKeywords');
    await this.channelKeywords.createIndex({ channelId: 1, keyword: 1 }, { unique: true });
    await this.channelKeywords.createIndex({ channelId: 1, cardCount: -1, lastUsed: -1 });
  }

  private async initializeAdSlots(): Promise<void> {
    this.adSlots = this.db.collection('adSlots');
    await this.adSlots.createIndex({ id: 1 }, { unique: true });
    await this.adSlots.createIndex({ status: 1, created: 1, geoTargets: 1 });
  }

  private async initializeCardComments(): Promise<void> {
    this.cardComments = this.db.collection('cardComments');
    await this.cardComments.createIndex({ id: 1 }, { unique: true });
    await this.cardComments.createIndex({ cardId: 1, curation: 1, byId: 1, at: -1 });
    await this.cardComments.createIndex({ at: -1 });
    await this.cardComments.createIndex({ byId: 1, at: -1 });
  }

  private async initializeDeposits(): Promise<void> {
    this.deposits = this.db.collection('deposits');
    const withoutId = await this.deposits.find<DepositRecord>({ id: { $exists: false } }).toArray();
    for (const deposit of withoutId) {
      await this.deposits.updateOne({ at: deposit.at }, { $set: { id: uuid.v4() } });
    }
    await this.deposits.createIndex({ id: 1 }, { unique: true });
    await this.deposits.createIndex({ at: -1 });
    await this.deposits.createIndex({ status: 1 });
  }

  private async initializeCardCampaigns(): Promise<void> {
    this.cardCampaigns = this.db.collection('cardCampaigns');
    await this.cardCampaigns.createIndex({ id: 1 }, { unique: true });
    await this.cardCampaigns.createIndex({ cardIds: 1 }, { unique: true });
    await this.cardCampaigns.createIndex({ status: 1, eligibleAfter: 1, type: 1, geoTargets: 1 });
  }

  private async initializeCardCampaignStats(): Promise<void> {
    this.cardCampaignStats = this.db.collection('cardCampaignStats');
    await this.cardCampaignStats.createIndex({ campaignId: 1, at: 1 }, { unique: true });
  }

  private async initializeShortUrls(): Promise<void> {
    this.shortUrls = this.db.collection('shortUrls');
    await this.shortUrls.createIndex({ code: 1 }, { unique: true });
  }

  private async initializeAuthorUsers(): Promise<void> {
    this.authorUsers = this.db.collection('authorUsers');
    await this.authorUsers.createIndex({ authorId: 1, userId: 1, periodStarting: -1 }, { unique: true });
    await this.authorUsers.createIndex({ authorId: 1, userId: 1, isCurrent: 1 });
    await this.authorUsers.createIndex({ userId: 1, isCurrent: 1 });
    await this.authorUsers.createIndex({ authorId: 1, isCurrent: 1 });
  }

  private async initializeUserStats(): Promise<void> {
    this.userStats = this.db.collection('userStats');
    await this.userStats.createIndex({ userId: 1, periodStarting: -1 }, { unique: true });
    await this.userStats.createIndex({ userId: 1, isCurrent: 1 });
  }

  async getNetwork(): Promise<NetworkRecord> {
    return this.networks.findOne({ id: '1' });
  }

  async updateNetworkCardPurchaseStatsUpdated(value: boolean): Promise<void> {
    await this.networks.updateOne({ id: "1" }, { $set: { cardPurchaseStatsUpdated: value } });
  }

  async incrementNetworkTotals(incrPublisherRev: number, incrCardDeveloperRev: number, incrDeposits: number, incrWithdrawals: number, incrPublisherSubsidies: number): Promise<void> {
    const update: any = {};
    let count = 0;
    if (incrPublisherRev) {
      update.totalPublisherRevenue = incrPublisherRev;
      count++;
    }
    if (incrCardDeveloperRev) {
      update.totalCardDeveloperRevenue = incrCardDeveloperRev;
      count++;
    }
    if (incrDeposits) {
      update.totalDeposits = incrDeposits;
      count++;
    }
    if (incrWithdrawals) {
      update.totalWithdrawals = incrWithdrawals;
      count++;
    }
    if (incrPublisherSubsidies) {
      update.totalPublisherSubsidies = incrPublisherSubsidies;
      count++;
    }
    if (count > 0) {
      await this.networks.updateOne({ id: "1" }, { $inc: update });
    }
  }

  async getOldUsers(): Promise<OldUserRecord[]> {
    return this.oldUsers.find().toArray();
  }

  async insertUser(type: UserAccountType, address: string, publicKey: string, encryptedPrivateKey: string, ipAddress: string, country: string, region: string, city: string, zip: string, referrer: string, landingPage: string, homeChannelId: string, firstArrivalCardId: string, initialBalance: number, id?: string, identity?: UserIdentity, includeInMailingList = true): Promise<UserRecord> {
    const now = Date.now();
    const record: UserRecord = {
      id: id ? id : uuid.v4(),
      sessionId: null,
      type: type,
      address: address,
      publicKey: publicKey,
      addressHistory: [
        { address: address, publicKey: publicKey, added: now }
      ],
      encryptedPrivateKey: encryptedPrivateKey,
      added: now,
      balanceLastUpdated: now,
      balance: 0,
      balanceBelowTarget: false,
      lastContact: now,
      storage: 0,
      admin: false,
      ipAddresses: [],
      lastPosted: 0,
      lastWithdrawal: 0,
      marketing: {
        includeInMailingList: includeInMailingList
      },
      originalReferrer: referrer,
      originalLandingPage: landingPage,
      homeChannelId: homeChannelId,
      firstCardPurchasedId: null,
      firstArrivalCardId: firstArrivalCardId,
      referralBonusPaidToUserId: null,
      lastLanguagePublished: null,
      preferredLangCodes: null,
      commentsLastReviewed: 0,
      initialBalance: initialBalance
    };
    if (identity) {
      if (!identity.emailAddress) {
        delete identity.emailAddress;
      }
      if (!identity.handle) {
        delete identity.handle;
      }
      record.identity = identity;
    }
    if (ipAddress) {
      record.ipAddresses.push(ipAddress);
    }
    if (country || region || city || zip) {
      record.country = country;
      record.region = region;
      record.city = city;
      record.zip = zip;
    }
    await this.users.insert(record);
    return record;
  }

  async updateUserSessionId(userId: string, sessionId: string): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { sessionId: sessionId } });
  }

  async updateUserBalance(userId: string, value: number): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { balance: value } });
  }

  async updateUserHomeChannel(userId: string, channelId: string): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { homeChannelId: channelId } });
  }

  async updateUserLastPosted(userId: string, value: number, language: string): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { lastPosted: value, lastLanguagePublished: language } });
  }

  async updateUserLastWithdrawal(user: UserRecord, value: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { lastWithdrawal: value } });
    user.lastWithdrawal = value;
  }

  async updateUserReferralBonusPaid(userId: string, paidToUserId: string): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { referralBonusPaidToUserId: paidToUserId } });
  }

  async updateUserRecoveryCode(user: UserRecord, code: string, expires: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { recoveryCode: code, recoveryCodeExpires: expires } });
    user.recoveryCode = code;
    user.recoveryCodeExpires = expires;
  }

  async updateUserGeo(userId: string, country: string, region: string, city: string, zip: string): Promise<void> {
    await this.users.updateOne({ id: userId }, {
      $set: {
        country: country,
        region: region,
        city: city,
        zip: zip
      }
    });
  }

  async updateUserCuration(userId: string, curation: UserCurationType): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { curation: curation } });
  }

  async clearRecoveryCode(user: UserRecord): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $unset: { recoveryCode: 1, recoveryCodeExpires: 1 } });
    delete user.recoveryCode;
    delete user.recoveryCodeExpires;
  }

  async updateUserContentNotification(user: UserRecord): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { "notifications.lastContentNotification": Date.now() } });
  }

  async updateUserAccountSettings(user: UserRecord, disallowPlatformNotifications: boolean, disallowContentNotifications: boolean, disallowCommentNotifications: boolean, preferredLangCodes: string[]): Promise<void> {
    await this.users.updateOne({ id: user.id }, {
      $set: {
        "notifications.disallowPlatformNotifications": disallowPlatformNotifications,
        "notifications.disallowContentNotifications": disallowContentNotifications,
        "notifications.disallowCommentNotifications": disallowCommentNotifications,
        preferredLangCodes: preferredLangCodes
      }
    });
    if (!user.notifications) {
      user.notifications = {};
    }
    user.notifications.disallowPlatformNotifications = disallowPlatformNotifications;
    user.notifications.disallowContentNotifications = disallowContentNotifications;
    user.notifications.disallowCommentNotifications = disallowCommentNotifications;
    user.preferredLangCodes = preferredLangCodes;
  }

  async updateUserCommentNotification(user: UserRecord): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { "notifications.lastCommentNotification": Date.now() } });
  }

  async updateUserFirstCardPurchased(userId: string, cardId: string): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { firstCardPurchasedId: cardId } });
  }

  async updateUserCommentsLastReviewed(userId: string, currentValue: number, newValue: number): Promise<boolean> {
    const result = await this.users.updateOne({ id: userId, commentsLastReviewed: currentValue }, { $set: { commentsLastReviewed: newValue } });
    return result.modifiedCount === 1;
  }

  async setUserCommentNotificationPending(userIds: string[], value: boolean): Promise<void> {
    await this.users.updateMany({ id: { $in: userIds } }, { $set: { commentNotificationPending: value } });
  }

  async findUserById(id: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ id: id });
  }

  getUsersById(ids: string[]): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ id: { $in: ids } });
  }

  async findUserByAddress(address: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ address: address });
  }

  async findUserByHistoricalAddress(address: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ "addressHistory.address": address });
  }

  async findUserByRecoveryCode(code: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ recoveryCode: code });
  }

  async findUserByInviterCode(code: string): Promise<UserRecord> {
    if (!code) {
      return null;
    }
    return this.users.findOne<UserRecord>({ inviterCode: code.toLowerCase() });
  }

  async findUsersByType(type: UserAccountType): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ type: type }).toArray();
  }

  async findUsersWithImageUrl(): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ "identity.imageUrl": { $exists: true } }).toArray();
  }

  getUsersWithIdentity(): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ identity: { $exists: true } });
  }

  async findNetworkUser(): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ type: "network" });
  }

  async findNetworkDeveloperUser(): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ type: "networkDeveloper" });
  }

  async findUserByHandle(handle: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ "identity.handle": handle.toLowerCase() });
  }

  async findUserByEmail(emailAddress: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ "identity.emailAddress": emailAddress.toLowerCase() });
  }

  async findUsersByIpAddress(ipAddress: string, limit = 25): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ ipAddresses: ipAddress }).sort({ added: -1 }).limit(limit).toArray();
  }

  async findUsersWithoutCountry(): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ country: { $exists: false } }).toArray();
  }

  async findUsersWithIdentity(limit = 500): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ identity: { $exists: true } }).sort({ lastContact: -1 }).limit(limit).toArray();
  }

  async findUsersByLastContact(limit = 500): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ type: "normal" }).sort({ lastContact: -1 }).limit(limit).toArray();
  }

  getUnconfirmedUsersWithNoLastNotice(): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ "identity.emailAddress": { $exists: true }, "identity.emailConfirmed": { $exists: false }, "identity.emailConfirmationCode": { $exists: false } });
  }

  getUserCursorByLastContact(from: number, to: number, addedBefore: number): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ type: "normal", lastContact: { $gt: from, $lte: to }, added: { $lte: addedBefore } }).sort({ lastContact: -1 });
  }

  getUserPublishers(): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ type: "normal", lastPosted: { $gt: 0 } }).sort({ lastPosted: -1 });
  }

  getUsersMissingHomeChannel(): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ identity: { $exists: true }, homeChannelId: { $exists: false } });
  }

  findUsersWithIdentityAmong(userIds: string[], limit: number): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ id: { $in: userIds }, identity: { $exists: true } }).limit(limit || 10).toArray();
  }

  async findUserChannelUserBonusPayers(): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ referralBonusPaidToUserId: { $ne: null } }).toArray();
  }

  async replaceUserImageUrl(userId: string, imageId: string): Promise<void> {
    await this.users.updateOne({ id: userId }, {
      $unset: { "identity.imageUrl": 1 },
      $set: { "identity.imageId": imageId }
    });
  }

  countTotalUsersBefore(before: number, after = 0): Promise<number> {
    const added: any = { $lt: before };
    if (after) {
      added.$gte = after;
    }
    return this.users.count({ added: added, type: "normal" });
  }

  countTotalUsersWithIdentity(before: number, after = 0): Promise<number> {
    const added: any = { $lt: before };
    if (after) {
      added.$gte = after;
    }
    return this.users.count({ added: added, identity: { $exists: true }, type: "normal" });
  }

  async updateLastUserContact(userRecord: UserRecord, lastContact: number): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $set: { lastContact: lastContact } });
    userRecord.lastContact = lastContact;
  }

  async deleteUser(id: string): Promise<void> {
    await this.users.deleteOne({ id: id });
  }

  async updateUserIdentity(userRecord: UserRecord, name: string, firstName: string, lastName: string, handle: string, imageId: string, location: string, emailAddress: string, emailConfirmed: boolean, encryptedPrivateKey: string): Promise<void> {
    const update: any = {};
    if (!userRecord.identity) {
      userRecord.identity = {
        name: null,
        handle: null,
        imageId: null,
        location: null,
        emailAddress: null,
        emailConfirmed: false,
        emailConfirmationCode: null,
        emailLastConfirmed: 0,
        firstName: null,
        lastName: null
      };
    }
    if (name) {
      update["identity.name"] = name;
      userRecord.identity.name = name;
    }
    if (firstName) {
      update["identity.firstName"] = firstName;
      userRecord.identity.firstName = firstName;
    }
    if (lastName) {
      update["identity.lastName"] = lastName;
      userRecord.identity.lastName = lastName;
    }
    if (handle) {
      update["identity.handle"] = handle.toLowerCase();
      userRecord.identity.handle = handle.toLowerCase();
    }
    if (imageId) {
      update["identity.imageId"] = imageId;
      userRecord.identity.imageId = imageId;
    }
    if (location) {
      update["identity.location"] = location;
      userRecord.identity.location = location;
    }
    if (emailAddress) {
      update["identity.emailAddress"] = emailAddress.toLowerCase();
      userRecord.identity.emailAddress = emailAddress.toLowerCase();
    }
    if (typeof emailConfirmed !== 'undefined') {
      update["identity.emailConfirmed"] = emailConfirmed;
      userRecord.identity.emailConfirmed = emailConfirmed;
    }
    if (encryptedPrivateKey) {
      update.encryptedPrivateKey = encryptedPrivateKey;
      userRecord.encryptedPrivateKey = encryptedPrivateKey;
    }
    await this.users.updateOne({ id: userRecord.id }, { $set: update });
  }

  async updateUserAddress(userRecord: UserRecord, address: string, publicKey: string, encryptedPrivateKey: string): Promise<void> {
    const now = Date.now();
    await this.users.updateOne({ id: userRecord.id }, {
      $set: {
        address: address,
        publicKey: publicKey,
        encryptedPrivateKey: encryptedPrivateKey
      },
      $push: {
        addressHistory: { address: address, publicKey: publicKey, added: now }
      }
    });
    userRecord.address = address;
    userRecord.publicKey = publicKey;
    userRecord.encryptedPrivateKey = encryptedPrivateKey;
    userRecord.addressHistory.push({
      address: address,
      publicKey: publicKey,
      added: now
    });
  }

  async updateUserMailingList(userRecord: UserRecord, mailingList: boolean): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $set: { "marketing.includeInMailingList": mailingList } });
    userRecord.marketing.includeInMailingList = mailingList;
  }

  async updateUserEmailConfirmationCode(user: UserRecord, code: string): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { "identity.emailConfirmed": false, "identity.emailConfirmationCode": code } });
  }

  async updateUserCommentNotificationPending(user: UserRecord, value: boolean): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { commentNotificationPending: value } });
  }

  getUsersWithCommentNotificationPending(): Cursor<UserRecord> {
    return this.users.find<UserRecord>({ commentNotificationPending: true });
  }

  async findUserByEmailConfirmationCode(code: string): Promise<UserRecord> {
    return this.users.findOne<UserRecord>({ "identity.emailConfirmationCode": code });
  }

  async updateUserEmailConfirmation(user: UserRecord): Promise<void> {
    const now = Date.now();
    await this.users.updateOne({ id: user.id }, { $set: { "identity.emailConfirmed": true, "identity.emailLastConfirmed": now }, $unset: { "identity.emailConfirmationCode": 1 } });
    user.identity.emailConfirmed = true;
    user.identity.emailLastConfirmed = now;
    delete user.identity.emailConfirmationCode;
  }

  async incrementUserStorage(user: UserRecord, size: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, {
      $inc: {
        storage: size
      }
    });
    user.storage += size;
  }

  async findUsersForBalanceUpdates(before: number): Promise<UserRecord[]> {
    return this.users.find<UserRecord>({ type: "normal", balanceLastUpdated: { $lt: before } }).toArray();
  }

  async incrementUserBalance(user: UserRecord, incrementBalanceBy: number, balanceBelowTarget: boolean, now: number, onlyIfLastBalanceUpdated = 0): Promise<void> {
    const query: any = {
      id: user.id
    };
    if (onlyIfLastBalanceUpdated) {
      query.balanceLastUpdated = onlyIfLastBalanceUpdated;
    }
    const result = await this.users.updateOne(query, {
      $inc: { balance: incrementBalanceBy },
      $set: { balanceBelowTarget: balanceBelowTarget, balanceLastUpdated: now }
    });
    if (result.modifiedCount > 0) {
      user.balance += incrementBalanceBy;
      user.balanceBelowTarget = balanceBelowTarget;
      user.balanceLastUpdated = now;
    } else {
      const updatedUser = await this.findUserById(user.id);
      if (updatedUser) {
        user.balance = updatedUser.balance;
        user.balanceBelowTarget = updatedUser.balanceBelowTarget;
        user.balanceLastUpdated = updatedUser.balanceLastUpdated;
      }
    }
  }

  async addUserIpAddress(userRecord: UserRecord, ipAddress: string, country: string, region: string, city: string, zip: string): Promise<void> {
    const update: any = { $push: { ipAddresses: ipAddress } };
    if (country || region || city || zip) {
      const setPart: any = {};
      setPart.country = country;
      setPart.region = region;
      setPart.city = city;
      setPart.zip = zip;
      update.$set = setPart;
    }
    await this.users.updateOne({ id: userRecord.id }, update);
    userRecord.ipAddresses.push(ipAddress);
  }

  async discardUserIpAddress(userRecord: UserRecord, ipAddress: string): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $pull: { ipAddresses: ipAddress } });
    userRecord.ipAddresses.splice(userRecord.ipAddresses.indexOf(ipAddress), 1);
  }

  async countUsersbalanceBelowTarget(): Promise<number> {
    return this.users.count({ type: "normal", balanceBelowTarget: true });
  }

  async insertCard(byUserId: string, sessionId: string, byAddress: string, byHandle: string, byName: string, cardImageId: string, linkUrl: string, iframeUrl: string, title: string, text: string, langCode: string, isPrivate: boolean, cardType: string, cardTypeIconUrl: string, cardTypeRoyaltyAddress: string, cardTypeRoyaltyFraction: number, openFeeUnits: number, keywords: string[], searchText: string, fileIds: string[], blocked: boolean, id?: string, now?: number): Promise<CardRecord> {
    if (!now) {
      now = Date.now();
    }
    if (!fileIds) {
      fileIds = [];
    }
    const record: CardRecord = {
      id: id ? id : uuid.v4(),
      sessionId: sessionId,
      state: "active",
      postedAt: now,
      createdById: byUserId,
      by: {
        address: byAddress,
        handle: byHandle,
        name: byName
      },
      summary: {
        imageId: cardImageId,
        linkUrl: linkUrl,
        iframeUrl: iframeUrl,
        title: title,
        text: text,
        langCode: langCode
      },
      keywords: this.cleanKeywords(keywords),
      private: isPrivate,
      cardType: {
        package: cardType,
        iconUrl: cardTypeIconUrl,
        royaltyAddress: cardTypeRoyaltyAddress,
        royaltyFraction: cardTypeRoyaltyFraction
      },
      pricing: {
        openFeeUnits: openFeeUnits,
      },
      stats: {
        revenue: { value: 0, lastSnapshot: 0 },
        promotionsPaid: { value: 0, lastSnapshot: 0 },
        openFeesPaid: { value: 0, lastSnapshot: 0 },
        clickFeesPaid: { value: 0, lastSnapshot: 0 },
        impressions: { value: 0, lastSnapshot: 0 },
        uniqueImpressions: { value: 0, lastSnapshot: 0 },
        opens: { value: 0, lastSnapshot: 0 },
        clicks: { value: 0, lastSnapshot: 0 },
        uniqueOpens: { value: 0, lastSnapshot: 0 },
        uniqueClicks: { value: 0, lastSnapshot: 0 },
        likes: { value: 0, lastSnapshot: 0 },
        dislikes: { value: 0, lastSnapshot: 0 },
        reports: { value: 0, lastSnapshot: 0 },
        refunds: { value: 0, lastSnapshot: 0 },
        fraudPurchases: { value: 0, lastSnapshot: 0 },
        normalPurchases: { value: 0, lastSnapshot: 0 },
        firstTimePurchases: { value: 0, lastSnapshot: 0 },
      },
      score: 0,
      lastScored: 0,
      lock: {
        server: '',
        at: 0
      },
      curation: {
        block: blocked
      },
      searchText: searchText,
      type: "normal",
      fileIds: fileIds
    };
    await this.cards.insert(record);
    return record;
  }

  private cleanKeywords(keywords: string[]): string[] {
    const fixedKeywords: string[] = [];
    if (keywords) {
      for (const keyword of keywords) {
        const kw = keyword.trim().replace(/[^a-zA-Z\s]/g, '');
        if (kw) {
          fixedKeywords.push(kw.toLowerCase());
        }
      }
    }
    return fixedKeywords;
  }

  async countCards(before: number, after: number): Promise<number> {
    return this.cards.count({ postedAt: { $lt: before, $gte: after } });
  }

  // async countNonPromotedCards(before: number, after: number): Promise<number> {
  //   return this.cards.count({ postedAt: { $lt: before, $gte: after }, "pricing.openFeeUnits": { $gt: 0 }, "pricing.promotionFee": 0 });
  // }

  // async countPromotedCards(before: number, after: number): Promise<number> {
  //   return this.cards.count({ postedAt: { $lt: before, $gte: after }, "pricing.openFeeUnits": { $gt: 0 }, "pricing.promotionFee": { $gt: 0 } });
  // }

  // async countAdCards(before: number, after: number): Promise<number> {
  //   return this.cards.count({ postedAt: { $lt: before, $gte: after }, "pricing.openFeeUnits": 0 });
  // }

  async lockCard(cardId: string, timeout: number, serverId: string): Promise<CardRecord> {
    const count = 0;
    while (count < 300) {
      const card = await this.cards.findOne({ id: cardId }, { fields: { searchText: 0 } });
      if (!card) {
        return null;
      }
      if (card.lock && card.lock.server === serverId && card.lock.at > 0) {
        return card;
      }
      if (card.lock && card.lock.at > 0 && Date.now() - card.lock.at > timeout || !card.lock || card.lock.at === 0) {
        const lock = { server: serverId, at: Date.now() };
        const query: any = { id: cardId };
        if (card.lock) {
          if (card.lock.server) {
            query["lock.server"] = card.lock.server;
          }
          if (card.lock.server) {
            query["lock.at"] = card.lock.at;
          }
        }
        const updateResult = await this.cards.updateOne(query, { $set: { lock: lock } });
        if (updateResult.modifiedCount === 1) {
          card.lock = lock;
          return card;
        }
      }
      await Utils.sleep(100);
    }
    throw new Error("Db.lockCard: Timeout waiting to lock card");
  }

  async unlockCard(card: CardRecord): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { lock: { server: '', at: 0 } } });
  }

  async updateCardReported(cardId: string, reported: boolean): Promise<void> {
    await this.cards.updateOne({ id: cardId }, { $set: { "curation.reported": reported } });
  }

  async findCardById(id: string, includeInactive: boolean, includeSearchText: boolean = false): Promise<CardRecord> {
    if (!id) {
      return null;
    }
    const query: any = { id: id };
    if (!includeInactive) {
      query.state = "active";
    }
    if (includeSearchText) {
      return this.cards.findOne<CardRecord>(query);
    } else {
      return this.cards.findOne<CardRecord>(query, { fields: { searchText: 0 } });
    }
  }

  // async findLastCardByUser(userId: string): Promise<CardRecord> {
  //   const results = await this.cards.find<CardRecord>({ createdById: userId }).sort({ postedAt: -1 }).limit(1).toArray();
  //   if (results.length > 0) {
  //     return results[0];
  //   } else {
  //     return null;
  //   }
  // }

  async findCardMostRecentByType(type: CardType): Promise<CardRecord> {
    const result = await this.cards.find<CardRecord>({ type: type }).sort({ postedAt: -1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    } else {
      return null;
    }
  }

  getCardsWithPromotion(since: number): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({
      postedAt: { $gt: since },
      "curation.block": false,
      $or: [
        { "pricing.promotionFee": { $gt: 0 } },
        { "pricing.openPayment": { $gt: 0 } }
      ]
    });
  }

  getCardsMissingSearchText(): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ searchText: { $exists: false } });
  }

  getCardsMissingBy(): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ by: { $exists: false } });
  }

  getCardsMissingCreatedById(): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ createdById: { $exists: false } });
  }

  getCardsWithSummaryImageUrl(): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ "summary.imageUrl": { $exists: true } });
  }

  getCardsLatestNonPromoted(): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ state: "active", "curation.block": false, private: false, "pricing.openFeeUnits": { $gt: 0 }, score: { $gt: 0 } }).sort({ postedAt: -1 });
  }

  async countAdvertisers(): Promise<number> {
    const authors = await this.cards.distinct('createdById', { "pricing.openFeeUnits": { $gt: 0 } });
    return authors.length;
  }

  async countAdCardsOpenOrClick(): Promise<number> {
    return this.cardCampaigns.count({ type: { $in: ["pay-to-open", "pay-to-click"] } });
  }

  async countAdCardsImpression(): Promise<number> {
    return this.cardCampaigns.count({ type: "impression-ad" });
  }

  async aggregateOpenClickRedemptions(): Promise<RedemptionInfo> {
    const result = await this.userCardActions.aggregate([
      { $match: { action: { $in: ["redeem-open-payment", "redeem-click-payment"] } } },
      {
        $group: {
          _id: "all",
          count: { $sum: 1 },
          total: { $sum: "$redeemOpen.amount" }
        }
      }
    ]).toArray();
    return {
      count: result.length > 0 ? result[0].count : 0,
      total: result.length > 0 ? result[0].total : 0
    };
  }

  async aggregateImpressionRedemptions(): Promise<RedemptionInfo> {
    const result = await this.userCardActions.aggregate([
      { $match: { action: "redeem-ad-impression" } },
      {
        $group: {
          _id: "all",
          count: { $sum: 1 },
          total: { $sum: "$redeemImpression.amount" }
        }
      }
    ]).toArray();
    return {
      count: result.length > 0 ? result[0].count : 0,
      total: result.length > 0 ? result[0].total : 0
    };
  }

  async countCardsReported(): Promise<number> {
    return this.cards.count({ "curation.reported": true });
  }

  async replaceCardBy(cardId: string, createdById: string): Promise<void> {
    await this.cards.updateOne({ id: cardId }, {
      $set: { createdById: createdById }
    });
  }

  async replaceCardSummaryImageUrl(cardId: string, imageId: string): Promise<void> {
    await this.cards.updateOne({ id: cardId }, {
      $unset: {
        "summary.imageUrl": 1,
        "summary.imageWidth": 1,
        "summary.imageHeight": 1
      },
      $set: { "summary.imageId": imageId }
    });
  }

  async countDistinctCardOwners(from: number, to: number): Promise<number> {
    const creators = await this.cards.distinct('createdById', { postedAt: { $gte: from, $lt: to } });
    return creators.length;
  }

  async aggregateCardRevenueByAuthor(authorId: string): Promise<number> {
    const result = await this.cards.aggregate([
      { $match: { createdById: authorId } },
      { $group: { _id: "1", revenue: { $sum: "$stats.revenue.value" } } }
    ]).toArray();
    if (result.length === 0) {
      return 0;
    }
    return result[0].revenue;
  }

  async updateCardSearchText(cardId: string, searchText: string): Promise<void> {
    await this.cards.updateOne({ id: cardId }, { $set: { searchText: searchText } });
  }

  async updateCardBy(cardId: string, address: string, handle: string, name: string): Promise<void> {
    await this.cards.updateOne({ id: cardId }, {
      $set: {
        "by.address": address,
        "by.handle": handle,
        "by.name": name
      }
    });
  }

  async updateCardScore(card: CardRecord, score: number): Promise<void> {
    const now = Date.now();
    await this.cards.updateOne({ id: card.id }, { $set: { score: score, lastScored: now } });
    card.score = score;
    card.lastScored = now;
  }

  async updateCardStats_Preview(cardId: string, postedAgo: number, revenue: number, likes: number, dislikes: number, impressions: number, opens: number): Promise<void> {
    const now = Date.now();
    await this.cards.updateOne({ id: cardId }, {
      $set: {
        postedAt: now - postedAgo,
        "stats.revenue.value": revenue,
        "stats.likes.value": likes,
        "stats.dislikes.value": dislikes,
        "stats.impressions.value": impressions,
        "stats.uniqueImpressions.value": impressions,
        "stats.opens.value": opens,
        "stats.uniqueOpens.value": opens
      }
    });
  }

  async updateCardSummary(card: CardRecord, title: string, text: string, langCode: string, linkUrl: string, imageId: string, keywords: string[]): Promise<void> {
    const update: any = {
      summary: {
        title: title,
        text: text,
        langCode: langCode,
        linkUrl: linkUrl,
        imageId: imageId
      }
    };
    if (keywords) {
      update.keywords = this.cleanKeywords(keywords);
    }
    await this.cards.updateOne({ id: card.id }, { $set: update });
  }

  async addCardStat(card: CardRecord, statName: string, value: number): Promise<void> {
    const update: any = {};
    update["stats." + statName] = { value: value, lastSnapshot: 0 };
    await this.cards.updateOne({ id: card.id }, { $set: update });
    (card.stats as any)[statName] = { value: value, lastSnapshot: 0 };
  }

  async updateCardAdmin(card: CardRecord, keywords: string[], blocked: boolean, boost: number, overrideReports: boolean): Promise<void> {
    const update: any = {
      keywords: this.cleanKeywords(keywords),
      "curation.block": blocked,
      "curation.boost": boost ? boost : 0,
      "curation.overrideReports": overrideReports,
      lastScored: 0  // to force immediately rescoring
    };
    await this.cards.updateOne({ id: card.id }, { $set: update });
  }

  async updateCardAdminBlocked(card: CardRecord, blocked: boolean): Promise<void> {
    const update: any = {
      "curation.block": blocked
    };
    await this.cards.updateOne({ id: card.id }, { $set: update });
  }

  async updateCardOpenFee(card: CardRecord, openFeeUnits: number): Promise<void> {
    const update: any = {
      $set: {
        "pricing.openFeeUnits": openFeeUnits
      }
    };
    await this.cards.updateOne({ id: card.id }, update);
  }

  async incrementCardStat(card: CardRecord, statName: string, incrementBy: number, lastSnapshot?: number): Promise<void> {
    const incClause: any = {};
    incClause["stats." + statName + ".value"] = incrementBy;
    const update: any = { $inc: incClause };
    if (lastSnapshot) {
      const snapClause: any = {};
      snapClause["stats." + statName + ".lastSnapshot"] = lastSnapshot;
      update.$set = snapClause;
    }
    await this.cards.updateOne({ id: card.id }, update);
    let stat = (card.stats as any)[statName] as CardStatistic;
    if (!stat) {
      (card.stats as any)[statName] = { value: incrementBy, lastSnapshot: lastSnapshot ? lastSnapshot : 0 };
      stat = (card.stats as any)[statName];
    }
    stat.value += incrementBy;
    if (lastSnapshot) {
      stat.lastSnapshot = lastSnapshot;
    }
  }

  async setCardPaymentStats(cardId: string, normal: number, firstTime: number, fraud: number): Promise<void> {
    const now = Date.now();
    const update: any = {
      "stats.normalPurchases": { value: normal, lastSnapshot: now },
      "stats.firstTimePurchases": { value: firstTime, lastSnapshot: now },
      "stats.fraudPurchases": { value: fraud, lastSnapshot: now },
    };
    await this.cards.updateOne({ id: cardId }, { $set: update });
  }

  async updateCardPrivate(card: CardRecord, isPrivate: boolean): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { private: isPrivate } });
    card.private = isPrivate;
  }

  async updateCardState(card: CardRecord, state: CardActiveState): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { state: state } });
    card.state = state;
  }

  async updateCardsBlockedByAuthor(userId: string, blocked: boolean): Promise<void> {
    await this.cards.updateMany({ createdById: userId }, { $set: { "curation.block": blocked } });
  }

  async updateCardsLastScoredByAuthor(userId: string, blocked: boolean): Promise<void> {
    await this.cards.updateMany({ createdById: userId }, { $set: { lastScored: 0 } });
  }

  async findCardsForScoring(postedAfter: number, scoredBefore: number): Promise<CardRecord[]> {
    return this.cards.find<CardRecord>({ state: "active", postedAt: { $gt: postedAfter }, lastScored: { $lt: scoredBefore } }, { searchText: 0 }).toArray();
  }

  async findCardsBySearch(searchText: string, skip: number, limit: number): Promise<CardRecord[]> {
    const query: any = {
      state: "active",
      "curation.block": false,
      private: false,
      $text: { $search: searchText }
    };
    return this.cards.find<CardRecord>(query, { searchScore: { $meta: "textScore" }, searchText: 0 }).sort({ searchScore: { $meta: "textScore" } }).skip(skip || 0).limit(limit).toArray();
  }

  getCardsByAuthor(userId: string): Cursor<CardRecord> {
    return this.cards.find<CardRecord>({ createdById: userId }, { searchText: 0 });
  }

  getCardsByUserAndTime(before: number, after: number, byUserId: string, excludePrivate: boolean, excludeBlocked: boolean, excludeDeleted: boolean): Cursor<CardRecord> {
    const query: any = excludeDeleted ? { state: "active" } : {};
    if (excludeBlocked) {
      query["curation.block"] = false;
    }
    query.createdById = byUserId;
    if (before && after) {
      query.postedAt = { $lt: before, $gt: after };
    } else if (before) {
      query.postedAt = { $lt: before };
    } else if (after) {
      query.postedAt = { $gt: after };
    }
    if (excludePrivate) {
      query.private = false;
    }
    return this.cards.find(query, { searchText: 0 }).sort({ postedAt: -1 });
  }

  async existsCardAdByAuthor(authorId: string): Promise<boolean> {
    const record = await this.cards.findOne<CardRecord>({ createdById: authorId, "pricing.openFeeUnits": 0 });
    return record ? true : false;
  }

  async findCardsByTime(limit: number): Promise<CardRecord[]> {
    limit = limit || 500;
    return this.cards.find<CardRecord>({ state: "active" }, { searchText: 0 }).sort({ postedAt: -1 }).limit(limit).toArray();
  }

  // async findRandomPayToOpenCard(excludeAuthorIds: string[], excludedCardIds: string[]): Promise<CardRecord> {
  //   let cursor = this.cards.find<CardRecord>({ state: "active", "curation.block": false, private: false, "budget.available": true, createdById: { $nin: excludeAuthorIds }, "pricing.openFeeUnits": 0, "pricing.openPayment": { $gt: 0 }, id: { $nin: excludedCardIds } });
  //   const count = await cursor.count();
  //   if (count === 0) {
  //     return null;
  //   }
  //   const skip = Math.floor(Math.random() * count);
  //   if (skip > 0) {
  //     cursor = cursor.skip(skip);
  //   }
  //   const result = await cursor.next();
  //   await cursor.close();
  //   return result;
  // }

  // async findRandomImpressionAdCard(excludeAuthorIds: string[], excludedCardIds: string[]): Promise<CardRecord> {
  //   let cursor = this.cards.find<CardRecord>({ state: "active", "curation.block": false, private: false, "budget.available": true, createdById: { $nin: excludeAuthorIds }, "pricing.openFeeUnits": 0, "pricing.promotionFee": { $gt: 0 }, id: { $nin: excludedCardIds } });
  //   const count = await cursor.count();
  //   // console.log("Db.findRandomImpressionAdCard", excludeAuthorId, excludedCardIds, count);
  //   if (count === 0) {
  //     return null;
  //   }
  //   const skip = Math.floor(Math.random() * count);
  //   if (skip > 0) {
  //     cursor = cursor.skip(skip);
  //   }
  //   const result = await cursor.next();
  //   // console.log("Db.findRandomImpressionAdCard after next", skip, result ? result.id : null);
  //   await cursor.close();
  //   return result;
  // }

  // async findRandomPromotedCard(excludeAuthorIds: string[], excludedCardIds: string[]): Promise<CardRecord> {
  //   let cursor = this.cards.find<CardRecord>({ state: "active", "curation.block": false, private: false, "budget.available": true, createdById: { $nin: excludeAuthorIds }, "pricing.openFeeUnits": { $gt: 0 }, "pricing.promotionFee": { $gt: 0 }, id: { $nin: excludedCardIds } });
  //   const count = await cursor.count();
  //   // console.log("Db.findRandomPromotedCard", excludeAuthorId, excludedCardIds, count);
  //   if (count === 0) {
  //     return null;
  //   }
  //   const skip = Math.floor(Math.random() * count);
  //   if (skip > 0) {
  //     cursor = cursor.skip(skip);
  //   }
  //   const result = await cursor.next();
  //   // console.log("Db.findRandomImpressionAdCard after next", skip, result ? result.id : null);
  //   await cursor.close();
  //   return result;
  // }

  // getCardCursorByPostedAt(from: number, to: number): Cursor<CardRecord> {
  //   return this.cards.find<CardRecord>({ state: "active", postedAt: { $gt: from, $lte: to } }, { searchText: 0 });
  // }

  // async findFirstCardByUser(userId: string): Promise<CardRecord> {
  //   const result = await this.cards.find<CardRecord>({ state: "active", createdById: userId }, { searchText: 0 }).sort({ postedAt: 1 }).limit(1).toArray();
  //   if (result.length > 0) {
  //     return result[0];
  //   }
  //   return null;
  // }

  getAccessibleCardsByTime(before: number, after: number, userId: string, excludeAds: boolean, excludeReportedCards: boolean): Cursor<CardRecord> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    if (before && after) {
      query.postedAt = { $lt: before, $gt: after };
    } else if (before) {
      query.postedAt = { $lt: before };
    } else if (after) {
      query.postedAt = { $gt: after };
    }
    if (excludeAds) {
      query["pricing.openFeeUnits"] = { $gt: 0 };
    }
    if (excludeReportedCards) {
      query.$or = [
        { curation: { $exists: false } },
        { "curation.reported": { $exists: false } },
        { "curation.reported": false },
        { "curation.overrideReports": true }
      ];
    }
    return this.cards.find(query, { searchText: 0 }).sort({ postedAt: -1 });
  }

  getCardsByRevenue(userId: string, lessThanOrEqual: number, since: number): Cursor<CardRecord> {
    const query: any = { state: "active", private: false, "curation.block": false };
    query["stats.revenue.value"] = lessThanOrEqual ? { $lte: lessThanOrEqual, $gt: 0 } : { $gt: 0 };
    if (since) {
      query.postedAt = { $gt: since };
    }
    return this.cards.find<CardRecord>(query, { searchText: 0 }).sort({ "stats.revenue.value": -1 });
  }

  private addAuthorClause(query: any, userId: string): void {
    query.$or = [
      { createdById: userId },
      { private: false, "curation.block": false }
    ];
  }

  async findCardsByScore(limit: number, userId: string, ads: boolean, scoreLessThan = 0): Promise<CardRecord[]> {
    return this.getCardsByScore(userId, ads, scoreLessThan).limit(limit).toArray();
  }

  getCardsByScore(userId: string, ads: boolean, scoreLessThan = 0): Cursor<CardRecord> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    query["pricing.openFeeUnits"] = ads ? { $lte: 0 } : { $gt: 0 };
    if (scoreLessThan) {
      query.score = { $lt: scoreLessThan };
    }
    return this.cards.find(query, { searchText: 0 }).sort({ score: -1 });
  }

  async findCardsUsingKeywords(keywords: string[], scoreLessThan: number, limit: number, userId: string): Promise<CardRecord[]> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    query.keywords = { $in: this.cleanKeywords(keywords) };
    if (scoreLessThan > 0) {
      query.score = { $lt: scoreLessThan };
    }
    return this.cards.find<CardRecord>(query).sort({ score: -1 }).limit(limit).toArray();
  }

  async countCardPostsByUser(userId: string, from: number, to: number): Promise<number> {
    return this.cards.count({ createdById: userId, postedAt: { $gt: from, $lte: to } });
  }

  async ensureMutationIndex(): Promise<void> {
    const existing = await this.mutationIndexes.findOne<MutationIndexRecord>({ id: '1' });
    if (existing) {
      return;
    }
    try {
      const record: MutationIndexRecord = {
        id: '1',
        index: 0
      };
      await this.mutationIndexes.insert(record);
    } catch (err) {
      errorManager.warning("Db.ensureMutationIndex: race condition", null);
    }
  }

  async incrementAndReturnMutationIndex(): Promise<number> {
    const record = await this.networks.findOneAndUpdate({ id: '1' }, { $inc: { index: 1 } });
    return record.value.index;
  }

  async insertMutation(cardId: string, group: CardStateGroup, by: string, mutation: Mutation, at: number): Promise<CardMutationRecord> {
    const index = await this.incrementAndReturnMutationIndex();
    const record: CardMutationRecord = {
      index: index,
      mutationId: uuid.v4(),
      cardId: cardId,
      group: group,
      by: by,
      at: at,
      mutation: mutation
    };
    await this.mutations.insert(record);
    return record;
  }

  async findMutationById(mutationId: string): Promise<CardMutationRecord> {
    return this.mutations.findOne<CardMutationRecord>({ mutationId: mutationId });
  }

  async findLastMutation(cardId: string, group: CardStateGroup): Promise<CardMutationRecord> {
    const mutations = await db.mutations.find<CardMutationRecord>({ cardId: cardId, group: group }).sort({ at: -1 }).limit(1).toArray();
    if (mutations.length > 0) {
      return mutations[0];
    } else {
      return null;
    }
  }

  async findLastMutationByIndex(): Promise<CardMutationRecord> {
    const mutations = await db.mutations.find<CardMutationRecord>().sort({ index: -1 }).limit(1).toArray();
    return mutations.length > 0 ? mutations[0] : null;
  }

  async findMutationsAfterIndex(index: number): Promise<CardMutationRecord[]> {
    return db.mutations.find<CardMutationRecord>({ index: { $gt: index } }).sort({ index: 1 }).toArray();
  }

  async upsertCardProperty(cardId: string, group: CardStateGroup, user: string, name: string, value: any): Promise<CardPropertyRecord> {
    const now = Date.now();
    const record: CardPropertyRecord = {
      cardId: cardId,
      group: group,
      user: user,
      name: name,
      value: value
    };
    await this.cardProperties.updateOne({ cardId: cardId, group: group, user: user, name: name }, record, { upsert: true });
    return record;
  }

  async findCardProperties(cardId: string, group: CardStateGroup, user: string): Promise<CardPropertyRecord[]> {
    return this.cardProperties.find<CardPropertyRecord>({ cardId: cardId, group: group, user: user }).sort({ name: 1 }).toArray();
  }

  async findCardProperty(cardId: string, group: CardStateGroup, user: string, name: string): Promise<CardPropertyRecord> {
    return this.cardProperties.findOne<CardPropertyRecord>({ cardId: cardId, group: group, user: user, name: name });
  }

  async deleteCardProperty(cardId: string, group: CardStateGroup, user: string, name: string): Promise<void> {
    await this.cardProperties.deleteOne({ cardId: cardId, group: group, user: user, name: name });
  }

  async deleteCardProperties(cardId: string): Promise<void> {
    await this.cardProperties.deleteMany({ cardId: cardId });
  }

  async insertCardCollection(cardId: string, group: CardStateGroup, user: string, collectionName: string, keyField?: string): Promise<CardCollectionRecord> {
    const now = Date.now();
    const record: CardCollectionRecord = {
      cardId: cardId,
      group: group,
      user: user,
      collectionName: collectionName
    };
    if (keyField) {
      record.keyField = keyField;
    }
    await this.cardCollections.insert(record);
    return record;
  }

  async findCardCollections(cardId: string, group: CardStateGroup, user: string): Promise<CardCollectionRecord[]> {
    return this.cardCollections.find<CardCollectionRecord>({ cardId: cardId, group: group, user: user }).toArray();
  }

  async deleteCardCollections(cardId: string): Promise<void> {
    await this.cardCollections.deleteMany({ cardId: cardId });
  }

  async insertCardCollectionItem(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, index: number, value: any): Promise<CardCollectionItemRecord> {
    const now = Date.now();
    const record: CardCollectionItemRecord = {
      cardId: cardId,
      group: group,
      user: user,
      collectionName: collectionName,
      key: key,
      index: index,
      value: value
    };
    await this.cardCollectionItems.insert(record);
    return record;
  }

  async deleteCardCollectionItem(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string): Promise<void> {
    await this.cardCollectionItems.deleteOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key });
  }

  async updateCardCollectionItem(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, value: any): Promise<void> {
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $set: { value: value } });
  }

  async moveCardCollectionItem(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, index: number): Promise<void> {
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $set: { index: index } });
  }

  async deleteCardCollectionItems(cardId: string): Promise<void> {
    await this.cardCollectionItems.deleteMany({ cardId: cardId });
  }

  async unsetCardCollectionItemField(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, path: string): Promise<void> {
    const update: any = {};
    update[path] = 0;
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $unset: update });
  }

  async updateCardCollectionItemField(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, path: string, value: any): Promise<void> {
    const update: any = {};
    update[path] = value;
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $set: update });
  }

  async incrementCardCollectionItemField(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, path: string, incrementBy: number): Promise<void> {
    const update: any = {};
    update[path] = incrementBy;
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $inc: update });
  }

  async findCardCollectionItemRecord(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string): Promise<CardCollectionItemRecord> {
    if (!key) {
      return null;
    }
    return this.cardCollectionItems.findOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key });
  }

  async findCardCollectionItems(cardId: string, group: CardStateGroup, user: string, collectionName: string): Promise<CardCollectionItemRecord[]> {
    return this.cardCollectionItems.find<CardCollectionItemRecord>({ cardId: cardId, group: group, user: user, collectionName: collectionName }).sort({ index: 1 }).toArray();
  }

  async findFirstCardCollectionItemRecordBeforeIndex(cardId: string, group: CardStateGroup, user: string, collectionName: string, beforeIndex: number): Promise<CardCollectionItemRecord> {
    const items = await this.cardCollectionItems.find({
      cardId: cardId,
      group: group,
      user: user,
      collectionName: collectionName,
      index: { $lt: beforeIndex }
    }).sort({ index: -1 }).limit(1).toArray();
    return items.length > 0 ? items[0] : null;
  }

  async findCardCollectionItemRecordLast(cardId: string, group: CardStateGroup, user: string, collectionName: string): Promise<CardCollectionItemRecord> {
    const items = await this.cardCollectionItems.find({
      cardId: cardId,
      group: group,
      user: user,
      collectionName: collectionName
    }).sort({ index: -1 }).limit(1).toArray();
    return items.length > 0 ? items[0] : null;
  }

  async updateCardCollectionItemRecord(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, value: any): Promise<void> {
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $set: { value: value } });
  }

  async deleteCardCollectionItemRecord(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string): Promise<void> {
    await this.cardCollectionItems.deleteOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key });
  }

  async updateCardCollectionItemIndex(cardId: string, group: CardStateGroup, user: string, collectionName: string, key: string, index: number): Promise<void> {
    await this.cardCollectionItems.updateOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key }, { $set: { index: index } });
  }

  async upsertCardFile(cardId: string, group: CardStateGroup, user: string, fileId: string, key: string): Promise<CardFileRecord> {
    const now = Date.now();
    const record: CardFileRecord = {
      cardId: cardId,
      group: group,
      user: user,
      fileId: fileId,
      key: key
    };
    await this.cardFiles.updateOne({ cardId: cardId, group: group, user: user, fileId: fileId }, record, { upsert: true });
    return record;
  }

  async findCardFiles(cardId: string, group: CardStateGroup, user: string): Promise<CardFileRecord[]> {
    return this.cardFiles.find<CardFileRecord>({ cardId: cardId, group: group, user: user }).sort({ fileId: 1 }).toArray();
  }

  async deleteCardFile(cardId: string, group: CardStateGroup, user: string, fileId: string): Promise<void> {
    await this.cardFiles.deleteOne({ cardId: cardId, group: group, user: user, fileId: fileId });
  }

  async deleteCardFiles(cardId: string): Promise<void> {
    await this.cardFiles.deleteMany({ cardId: cardId });
  }

  async insertFile(status: FileStatus, s3Bucket: string): Promise<FileRecord> {
    const now = Date.now();
    const record: FileRecord = {
      id: uuid.v4(),
      at: now,
      status: status,
      ownerId: null,
      size: 0,
      filename: null,
      encoding: null,
      mimetype: null,
      s3: {
        bucket: s3Bucket,
        key: null
      },
      url: null,
      imageInfo: null
    };
    await this.files.insert(record);
    return record;
  }

  async updateFileStatus(fileRecord: FileRecord, status: FileStatus): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, { $set: { status: status } });
    fileRecord.status = status;
  }

  async updateFileProgress(fileRecord: FileRecord, ownerId: string, filename: string, encoding: string, mimetype: string, s3Key: string, status: FileStatus): Promise<void> {
    const update: any = {
      ownerId: ownerId,
      filename: filename,
      encoding: encoding,
      mimetype: mimetype,
      "s3.key": s3Key,
      status: status
    };
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: update
    });
    fileRecord.ownerId = ownerId;
    fileRecord.filename = filename;
    fileRecord.encoding = encoding;
    fileRecord.mimetype = mimetype;
    fileRecord.s3.key = s3Key;
    fileRecord.status = status;
  }

  async updateFileImageInfo(fileId: string, imageInfo: ImageInfo): Promise<void> {
    await this.files.updateOne({ id: fileId }, { $set: { imageInfo: imageInfo } });
  }

  async updateFileCompletion(fileRecord: FileRecord, status: FileStatus, size: number, url: string, imageInfo?: ImageInfo): Promise<void> {
    const update: any = {
      status: status,
      size: size,
      url: url
    };
    if (imageInfo) {
      update.imageInfo = imageInfo;
    }
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: update
    });
    fileRecord.status = status;
    fileRecord.size = size;
    if (imageInfo) {
      fileRecord.imageInfo = imageInfo;
    }
  }

  async findFileById(id: string): Promise<FileRecord> {
    if (!id) {
      return null;
    }
    return this.files.findOne<FileRecord>({ id: id });
  }

  async insertCardOpens(record: CardOpensRecord): Promise<boolean> {
    try {
      await this.cardOpens.insertOne(record);
      return true;
    } catch (err) {
      console.log("Db.insertCardOpens: collision inserting card opens record");
      return false;
    }
  }

  async finalizeCardOpensPeriod(periodStarted: number, periodEnded: number): Promise<boolean> {
    const result = await this.cardOpens.updateOne({ periodStarted: periodStarted, periodEnded: 0 }, { $set: { periodEnded: periodEnded } });
    return result.modifiedCount === 1;
  }

  async findFirstCardOpensBefore(before: number): Promise<CardOpensRecord> {
    const result = await this.cardOpens.find<CardOpensRecord>({ periodStarted: { $lt: before } }).sort({ periodStarted: -1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    } else {
      return null;
    }
  }

  async findCurrentCardOpens(): Promise<CardOpensRecord> {
    const result = await this.cardOpens.find<CardOpensRecord>({}).sort({ periodStarted: -1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    } else {
      return null;
    }
  }

  async incrementCardOpensData(periodStarted: number, additions: CardOpensInfo): Promise<boolean> {
    const increments: any = {};
    if (!additions.opens && !additions.units) {
      return true;
    }
    if (additions.opens) {
      increments["thisPeriod.opens"] = additions.opens;
      increments["total.opens"] = additions.opens;
    }
    if (additions.units) {
      increments["thisPeriod.units"] = additions.units;
      increments["total.units"] = additions.units;
    }
    const result = await this.cardOpens.updateOne({ periodStarted: periodStarted, periodEnded: 0 }, { $inc: increments });
    return result.modifiedCount === 1;
  }

  async getSubsidyBalance(): Promise<SubsidyBalanceRecord> {
    return this.subsidyBalance.findOne<SubsidyBalanceRecord>({ id: "1" });
  }

  async incrementSubsidyContributions(lastContribution: number, newLastContribution: number, amount: number): Promise<boolean> {
    const result = await this.subsidyBalance.updateOne({ id: "1", lastContribution: lastContribution }, {
      $inc: {
        balance: amount,
        totalContributions: amount
      },
      $set: {
        lastContribution: newLastContribution
      }
    });
    return result.modifiedCount === 1;
  }

  async incrementSubsidyPayments(amount: number): Promise<void> {
    await this.subsidyBalance.updateOne({ id: "1" }, {
      $inc: {
        balance: -amount,
        totalPayments: amount
      }
    });
  }

  async updateBowerManagement(id: string, serverId: string, status: string, timestamp: number, whereStatus?: string, whereTimestamp?: number): Promise<boolean> {
    const update: any = {
      serverId: serverId,
      status: status,
      timestamp: timestamp
    };
    const query: any = {
      id: id
    };
    if (whereStatus) {
      query.status = whereStatus;
    }
    if (typeof whereTimestamp === 'number') {
      query.timestamp = whereTimestamp;
    }
    const writeResult = await this.bowerManagement.updateOne(query, { $set: update });
    return writeResult.modifiedCount === 1;
  }

  async findBowerManagement(id: string): Promise<BowerManagementRecord> {
    return this.bowerManagement.findOne<BowerManagementRecord>({ id: id });
  }

  async insertBankTransaction(sessionId: string, at: number, originatorUserId: string, participantUserIds: string[], relatedCardTitle: string, details: BankTransactionDetails, recipientUserIds: string[], signedObject: SignedObject, deductions: number, remainderShares: number, withdrawalType: string, description: string, fromIpAddress: string, fromFingerprint: string): Promise<BankTransactionRecord> {
    const record: BankTransactionRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      at: at,
      originatorUserId: originatorUserId,
      participantUserIds: participantUserIds,
      relatedCardTitle: relatedCardTitle,
      details: details,
      recipientUserIds: recipientUserIds,
      signedObject: signedObject,
      deductions: deductions,
      remainderShares: remainderShares,
      refunded: false,
      description: description,
      fromIpAddress: fromIpAddress,
      fromFingerprint: fromFingerprint
    };
    if (withdrawalType) {
      record.withdrawalInfo = {
        type: withdrawalType,
        referenceId: null,
        status: "Initiated",
        error: null
      };
    }
    await this.bankTransactions.insert(record);
    return record;
  }

  async findBankTransactionById(id: string): Promise<BankTransactionRecord> {
    return this.bankTransactions.findOne<BankTransactionRecord>({ id: id });
  }

  async findBankTransactionForCardPayment(originatorUserId: string, relatedCardId: string): Promise<BankTransactionRecord> {
    return this.bankTransactions.findOne<BankTransactionRecord>({ originatorUserId: originatorUserId, "details.reason": "card-open-fee", "details.relatedCardId": relatedCardId });
  }

  async findBankTransactionsByParticipant(participantUserId: string, omitInterest: boolean, limit = 500): Promise<BankTransactionRecord[]> {
    const query: any = {
      participantUserIds: participantUserId
    };
    if (omitInterest) {
      query["details.reason"] = { $nin: ["interest", "subsidy"] };
    }
    return this.bankTransactions.find<BankTransactionRecord>(query).sort({ "details.timestamp": -1 }).limit(limit).toArray();
  }

  async countBankTransactions(): Promise<number> {
    return this.bankTransactions.count({});
  }

  async countBankTransactionsByReason(reason: BankTransactionReason, before: number, after: number): Promise<number> {
    return this.bankTransactions.count({ "details.reason": reason, "details.timestamp": { $lt: before, $gte: after } });
  }

  async countBankTransactionsByReasonWithAmount(reason: BankTransactionReason, before: number, after: number, amount: number): Promise<number> {
    return this.bankTransactions.count({ "details.reason": reason, "details.timestamp": { $lt: before, $gte: after }, "details.amount": amount });
  }

  async totalBankTransactionsAmountByReason(reason: BankTransactionReason, before: number, after: number): Promise<number> {
    const result = await this.bankTransactions.aggregate([
      { $match: { "details.reason": reason, "details.timestamp": { $lt: before, $gte: after } } },
      { $group: { _id: "total", count: { $sum: 1 }, total: { $sum: "$details.amount" } } }
    ]).toArray();
    if (result.length === 0) {
      return 0;
    }
    return result.length > 0 ? result[0].total : 0;
  }

  async updateBankTransactionWithdrawalStatus(transactionId: string, referenceId: string, status: string, err: any): Promise<void> {
    await this.bankTransactions.updateOne({ id: transactionId }, {
      $set: {
        "withdrawalInfo.referenceId": referenceId,
        "withdrawalInfo.status": status,
        "withdrawalInfo.err": err
      }
    });
  }

  async updateBankTransactionRefund(transactionId: string, refunded: boolean, refundInfo: BankTransactionRefundInfo): Promise<void> {
    await this.bankTransactions.updateOne({ id: transactionId }, {
      $set: {
        refunded: refunded,
        refundInfo: refundInfo
      }
    });
  }

  async insertUserCardAction(sessionId: string, userId: string, geo: GeoLocation, cardId: string, authorId: string, at: number, action: CardActionType, paymentInfo: UserCardActionPaymentInfo, redeemPromotion: number, redeemAdImpression: number, redeemOpen: number, redeemOpenNet: number, redeemTransactionId: string, redeemCampaignId: string, fraudReason: CardPaymentFraudReason, reportInfo: UserCardActionReportInfo, referringUserId: string): Promise<UserCardActionRecord> {
    const record: UserCardActionRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      userId: userId,
      cardId: cardId,
      authorId: authorId,
      at: at,
      action: action,
      geo: geo,
      referringUserId: referringUserId
    };
    if (fraudReason) {
      record.fraudReason = fraudReason;
    }
    if (paymentInfo) {
      record.payment = paymentInfo;
    }
    if (redeemPromotion) {
      record.redeemPromotion = {
        amount: redeemPromotion,
        transactionId: redeemTransactionId,
        cardCampaignId: redeemCampaignId
      };
    }
    if (redeemAdImpression) {
      record.redeemAdImpression = {
        amount: redeemAdImpression,
        transactionId: redeemTransactionId,
        cardCampaignId: redeemCampaignId
      };
    }
    if (redeemOpen) {
      record.redeemOpen = {
        amount: redeemOpen,
        netAmount: redeemOpenNet,
        transactionId: redeemTransactionId,
        cardCampaignId: redeemCampaignId
      };
    }
    if (reportInfo) {
      record.report = reportInfo;
    }
    await this.userCardActions.insert(record);
    return record;
  }

  async findRecentCardActions(userId: string, action: CardActionType, limit = 25): Promise<UserCardActionRecord[]> {
    return this.userCardActions.find<UserCardActionRecord>({ userId: userId, action: action }).sort({ at: -1 }).limit(limit).toArray();
  }

  getUserCardActionsFromTo(from: number, to: number): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ at: { $gt: from, $lte: to } });
  }

  getUserCardPayments(before: number): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ at: { $lt: before } });
  }

  getUserCardPayActionsWithoutAuthor(): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ action: "pay", authorId: { $exists: false } }).sort({ at: 1 });
  }

  getWeightedUserActionPayments(): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ action: "pay", "payment.weight": { $ne: 1 } }).sort({ at: 1 });
  }

  getUserCardActionsWithFromIpAddress(since: number): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ at: { $gt: since }, fromIpAddress: { $exists: true } });
  }

  async findDistinctReportedCardIds(): Promise<string[]> {
    return this.userCardActions.distinct('cardId', { action: "report" });
  }

  async findUserCardActionsByCardAndTime(actions: CardActionType[], cardId: string, maxCount: number, after: number): Promise<UserCardActionRecord[]> {
    const query: any = { cardId: cardId };
    if (actions) {
      query.actions = { $in: actions };
    }
    if (after) {
      query.at = { $gt: after };
    }
    let results = await this.userCardActions.find(query).sort({ at: after ? 1 : -1 }).limit(maxCount || 100).toArray();
    if (!after) {
      results = results.reverse();
    }
    return results;
  }

  async findUserCardActionsByAuthorAndTime(actions: CardActionType[], authorId: string, maxCount: number, after: number): Promise<UserCardActionRecord[]> {
    const query: any = { authorId: authorId };
    if (actions) {
      query.actions = { $in: actions };
    }
    if (after) {
      query.at = { $gt: after };
    }
    let results = await this.userCardActions.find(query).sort({ at: after ? 1 : -1 }).limit(maxCount || 100).toArray();
    if (!after) {
      results = results.reverse();
    }
    return results;
  }

  async updateUserActionPaymentWeightedRevenue(id: string, weightedRevenue: number): Promise<void> {
    await this.userCardActions.updateOne({ id: id }, { $set: { "payment.weightedRevenue": weightedRevenue } });
  }

  async updateUserActionWithGeo(id: string, geo: GeoLocation): Promise<void> {
    await this.userCardActions.updateOne({ id: id }, {
      $set: { geo: geo },
      $unset: { fromIpAddress: 1, fromFingerprint: 1 }
    });
  }

  getUserCardActionsWithoutGeo(since: number): Cursor<UserCardActionRecord> {
    return this.userCardActions.find<UserCardActionRecord>({ at: { $gt: since }, countryCode: { $exists: false } });
  }

  async findFirstUserCardActionByUser(userId: string, action: CardActionType): Promise<UserCardActionRecord> {
    const result = await this.userCardActions.find<UserCardActionRecord>({ userId: userId, action: action }).sort({ at: 1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    }
    return null;
  }

  async findUserCardActionReports(cardId: string, limit: number): Promise<UserCardActionRecord[]> {
    return this.userCardActions.find<UserCardActionRecord>({ cardId: cardId, action: "report" }).sort({ at: -1 }).limit(limit || 10).toArray();
  }

  async countUserCardsOpenedInTimeframe(userId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ userId: userId, action: "open", at: { $gt: from, $lte: to } });
  }

  async countUserCardsPaid(userId: string): Promise<number> {
    return this.userCardActions.count({ userId: userId, action: "pay" });
  }

  async countUserCardPurchasesToAuthor(userId: string, authorId: string): Promise<number> {
    return this.userCardActions.count({ userId: userId, action: "pay", authorId: authorId });
  }

  async countUserCardPurchasesByUser(userId: string): Promise<number> {
    return this.userCardActions.count({ action: "pay", userId: userId });
  }

  async countAuthorCardPurchases(authorId: string): Promise<number> {
    return this.userCardActions.count({ action: "pay", authorId: authorId, fraudReason: { $exists: false } });
  }

  async countDistinctCardPurchaseAuthors(userId: string): Promise<number> {
    const authors = await this.userCardActions.distinct('authorId', { action: "pay", userId: userId });
    return authors.length;
  }

  async countDistinctCardPurchasers(authorId: string): Promise<number> {
    const users = await this.userCardActions.distinct('userId', { action: "pay", authorId: authorId, fraudReason: { $exists: false } });
    return users.length;
  }

  async countUserCardsPaidFromIpAddress(cardId: string, fromIpAddress: string, fromFingerprint: string): Promise<number> {
    return this.userCardActions.count({ cardId: cardId, action: "pay", fromIpAddress: fromIpAddress, fromFingerprint: fromFingerprint });
  }

  async countUserCardsPaidFromFingerprint(cardId: string, fromFingerprint: string, ipAddress: string): Promise<number> {
    const query: any = { cardId: cardId, action: "pay", fromFingerprint: fromFingerprint };
    if (ipAddress) {
      query.fromIpAddress = ipAddress;
    }
    return this.userCardActions.count(query);
  }

  async countUserCardsPaidInTimeframe(userId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ userId: userId, action: "pay", at: { $gt: from, $lte: to } });
  }

  async countUserCardActionsInTimeframe(userId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ userId: userId, at: { $gt: from, $lte: to } });
  }

  async countCardPayments(cardId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ cardId: cardId, action: "pay", at: { $gt: from, $lte: to } });
  }

  async countCardImpressions(cardId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ cardId: cardId, action: "impression", at: { $gt: from, $lte: to } });
  }

  async countDistinctUserImpressions(cardId: string, from: number, to: number): Promise<number> {
    const userIds = await this.userCardActions.distinct("userId", { cardId: cardId, action: "impression", at: { $gt: from, $lte: to } });
    return userIds.length;
  }

  async countCardClicks(cardId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ cardId: cardId, action: "click", at: { $gt: from, $lte: to } });
  }

  async countDistinctUserClicks(cardId: string, from: number, to: number): Promise<number> {
    const userIds = await this.userCardActions.distinct("userId", { cardId: cardId, action: "click", at: { $gt: from, $lte: to } });
    return userIds.length;
  }

  async countCardPromotedPayments(cardId: string, from: number, to: number): Promise<number> {
    return this.userCardActions.count({ cardId: cardId, action: "redeem-open-payment", at: { $gt: from, $lte: to } });
  }

  async countDistinctUserPromotedPayments(cardId: string, from: number, to: number): Promise<number> {
    const userIds = await this.userCardActions.distinct("userId", { cardId: cardId, action: "redeem-open-payment", at: { $gt: from, $lte: to } });
    return userIds.length;
  }

  async countUserCardOpens(before: number, after: number): Promise<number> {
    return this.userCardActions.count({ action: "open", at: { $lt: before, $gte: after } });
  }

  async findDistinctUsersActiveBetween(from: number, to: number): Promise<string[]> {
    return (await this.userCardActions.distinct("userId", { at: { $gte: from, $lt: to } })) as string[];
  }

  async updateUserCardActionWithPaymentInfo(id: string, authorId: string, paymentInfo: UserCardActionPaymentInfo): Promise<void> {
    await this.userCardActions.updateOne({ id: id }, {
      $set: {
        authorId: authorId,
        payment: paymentInfo
      }
    });
  }

  async aggregateUserActionPaymentsForAuthor(authorId: string, since: number): Promise<AggregatedUserActionPaymentInfo[]> {
    const query: any = { action: "pay", authorId: authorId };
    if (since) {
      query.at = { $gt: since };
    }
    return this.userCardActions.aggregate([
      { $match: query },
      { $group: { _id: "$payment.category", purchases: { $sum: 1 }, grossRevenue: { $sum: "$payment.amount" }, weightedRevenue: { $sum: "$payment.weightedRevenue" } } }
    ]).toArray();
  }

  async aggregateUserCardPayments(before: number): Promise<AggregatedCardPaymentInfo[]> {
    const query: any = { action: "pay", at: { $lt: before } };
    return this.userCardActions.aggregate([
      { $match: { action: "pay" } },
      {
        $group: {
          _id: "$cardId",
          firstTimePurchases: {
            $sum: {
              $cond: {
                if: { $eq: ["$payment.category", "first"] },
                then: 1,
                else: 0
              }
            }
          },
          normalPurchases: {
            $sum: {
              $cond: {
                if: { $in: ["$payment.category", ["fan", "normal"]] },
                then: 1,
                else: 0
              }
            }
          },
          fraudPurchases: {
            $sum: {
              $cond: {
                if: { $eq: ["$payment.category", "fraud"] },
                then: 1,
                else: 0
              }
            }
          },
        }
      }
    ]).toArray();
  }

  async countUserActionPaymentsForAuthor(authorId: string, since: number): Promise<AggregatedUserActionPaymentInfo> {
    const query: any = { action: "pay", authorId: authorId };
    if (since) {
      query.at = { $gt: since };
    }
    const result: any[] = await this.userCardActions.aggregate([
      { $match: query },
      { $group: { _id: "all", purchases: { $sum: 1 }, grossRevenue: { $sum: "$payment.amount" }, weightedRevenue: { $sum: "$payment.weightedRevenue" } } }
    ]).toArray();
    return result[0];
  }

  async ensureUserCardInfo(userId: string, cardId: string): Promise<UserCardInfoRecord> {
    let record = await this.findUserCardInfo(userId, cardId);
    if (!record) {
      try {
        record = {
          userId: userId,
          cardId: cardId,
          created: Date.now(),
          lastImpression: 0,
          lastOpened: 0,
          lastClicked: 0,
          lastClosed: 0,
          lastCommentsFetch: 0,
          paidToAuthor: 0,
          paidToReader: 0,
          earnedFromAuthor: 0,
          earnedFromReader: 0,
          openFeeRefunded: false,
          transactionIds: [],
          like: "none",
          referredPurchases: 0
        };
        await this.userCardInfo.insert(record);
      } catch (err) {
        record = await this.findUserCardInfo(userId, cardId);
      }
    }
    return record;
  }

  async findUserCardInfo(userId: string, cardId: string): Promise<UserCardInfoRecord> {
    return this.userCardInfo.findOne<UserCardInfoRecord>({ userId: userId, cardId: cardId });
  }

  async findUserCardInfoForUser(userId: string): Promise<UserCardInfoRecord[]> {
    return this.userCardInfo.find<UserCardInfoRecord>({ userId: userId }).sort({ cardId: 1 }).toArray();
  }

  async findRecentCardOpens(userId: string, limit = 25, before = 0): Promise<UserCardInfoRecord[]> {
    const query: any = { userId: userId };
    query.lastOpened = before > 0 ? { $lt: before, $gt: 0 } : { $gt: 0 };
    return this.userCardInfo.find<UserCardInfoRecord>(query).sort({ lastOpened: -1 }).limit(limit).toArray();
  }

  getUserCardsWithPendingCommentNotifications(userId: string): Cursor<UserCardInfoRecord> {
    return this.userCardInfo.find<UserCardInfoRecord>({ userId: userId, commentNotificationPending: true });
  }

  async updateUserCardCommentNotificationPending(userId: string, cardId: string, value: boolean): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { commentNotificationPending: value } });
  }

  async updateUserCardsCommentNotificationPending(userIds: string[], cardId: string, value: boolean): Promise<void> {
    for (const userId of userIds) {
      await this.ensureUserCardInfo(userId, cardId);
    }
    await this.userCardInfo.updateMany({ userId: { $in: userIds }, cardId: cardId }, { $set: { commentNotificationPending: value } });
  }

  async updateUserCardLastImpression(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastImpression: value } });
  }

  async updateUserCardLastOpened(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastOpened: value, lastCommentsFetch: value } });
  }

  async updateUserCardLastClicked(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastClicked: value } });
  }

  async updateUserCardLastCommentFetch(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastCommentsFetch: value } });
  }

  async updateUserCardLastClosed(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastClosed: value } });
  }

  async updateUserCardIncrementPaidToAuthor(userId: string, cardId: string, amount: number, transactionId: string): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $inc: { paidToAuthor: amount }, $push: { transactionIds: transactionId } });
  }

  async updateUserCardIncrementPaidToReader(userId: string, cardId: string, amount: number, transactionId: string): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $inc: { paidToReader: amount }, $push: { transactionIds: transactionId } });
  }

  async updateUserCardIncrementEarnedFromAuthor(userId: string, cardId: string, amount: number, transactionId: string): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $inc: { earnedFromAuthor: amount }, $push: { transactionIds: transactionId } });
  }

  async updateUserCardIncrementEarnedFromReader(userId: string, cardId: string, amount: number, transactionId: string): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $inc: { earnedFromReader: amount }, $push: { transactionIds: transactionId } });
  }

  async updateUserCardInfoLikeState(userId: string, cardId: string, state: CardLikeState): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { like: state } });
  }

  async updateUserCardInfoOpenFeeRefund(userId: string, cardId: string, openFeeRefunded: boolean): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { openFeeRefunded: openFeeRefunded } });
  }

  async incrementUserCardReferredPurchases(userCardInfo: UserCardInfoRecord, incrementBy: number): Promise<void> {
    await this.userCardInfo.updateOne({ userId: userCardInfo.userId, cardId: userCardInfo.cardId }, { $inc: { referredPurchases: incrementBy } });
    userCardInfo.referredPurchases += incrementBy;
  }

  async countCardLikes(userId: string): Promise<number> {
    return this.userCardInfo.count({ userId: userId, like: "like" });
  }

  async insertBankCoupon(sessionId: string, signedObject: SignedObject, byUserId: string, byAddress: string, timestamp: number, amount: number, budgetAmount: number, budgetPlusPercent: number, reason: BankTransactionReason, cardId: string): Promise<BankCouponRecord> {
    const record: BankCouponRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      signedObject: signedObject,
      byUserId: byUserId,
      byAddress: byAddress,
      timestamp: timestamp,
      amount: amount,
      budget: {
        amount: budgetAmount,
        plusPercent: budgetPlusPercent,
        spent: 0
      },
      reason: reason,
      cardId: cardId
    };
    await this.bankCoupons.insert(record);
    return record;
  }

  async findBankCouponById(id: string): Promise<BankCouponRecord> {
    return this.bankCoupons.findOne<BankCouponRecord>({ id: id });
  }

  async incrementCouponSpent(couponId: string, amount: number): Promise<void> {
    await this.bankCoupons.updateOne({ id: couponId }, {
      $inc: { "budget.spent": amount }
    });
  }

  async insertManualWithdrawal(sessionId: string, userId: string, transactionId: string, state: ManualWithdrawalState, created: number, amount: number, recipientContact: string): Promise<ManualWithdrawalRecord> {
    const record: ManualWithdrawalRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      userId: userId,
      transactionId: transactionId,
      state: state,
      created: created,
      amount: amount,
      recipientContact: recipientContact,
      lastUpdated: created,
      lastUpdatedBy: null,
      paymentReferenceId: null
    };
    await this.manualWithdrawals.insert(record);
    return record;
  }

  async listManualWithdrawals(limit: number): Promise<ManualWithdrawalRecord[]> {
    return this.manualWithdrawals.find<ManualWithdrawalRecord>({}).sort({ created: -1 }).limit(limit ? limit : 100).toArray();
  }

  async findManualWithdrawalById(id: string): Promise<ManualWithdrawalRecord> {
    return this.manualWithdrawals.findOne<ManualWithdrawalRecord>({ id: id });
  }

  async updateManualWithdrawal(id: string, state: ManualWithdrawalState, paymentReferenceId: string, byUserId: string): Promise<void> {
    const update: any = {
      state: state,
      lastUpdated: Date.now(),
      lastUpdatedBy: byUserId
    };
    if (paymentReferenceId) {
      update.paymentReferenceId = paymentReferenceId;
    }
    await this.manualWithdrawals.updateOne({ id: id }, { $set: update });
  }

  async insertCardStatsHistory(cardId: string, statName: string, value: number, at: number): Promise<CardStatisticHistoryRecord> {
    const record: CardStatisticHistoryRecord = {
      cardId: cardId,
      statName: statName,
      value: value,
      at: at
    };
    await this.cardStatsHistory.insert(record);
    return record;
  }

  async findCardStatsHistory(cardId: string, statName: string, maxCount: number): Promise<CardStatisticHistoryRecord[]> {
    return this.cardStatsHistory.find({ cardId: cardId, statName: statName }).sort({ at: -1 }).limit(maxCount ? maxCount : 50).toArray();
  }

  async upsertBowerPackage(packageName: string, pkg: BowerInstallResult, channelComponent: ChannelComponentDescriptor): Promise<BowerPackageRecord> {
    const record: BowerPackageRecord = {
      packageName: packageName,
      installed: Date.now(),
      package: JSON.stringify(pkg),
      channelComponent: channelComponent
    };
    await this.bowerPackages.update({ packageName: packageName }, record, { upsert: true });
    return record;
  }

  async findBowerPackage(packageName: string): Promise<BowerPackageRecord> {
    return this.bowerPackages.findOne<BowerPackageRecord>({ packageName: packageName });
  }

  async insertPublisherSubsidyDays(starting: number, totalCoins: number, coinsPerPaidOpen: number, returnUserBonus: number): Promise<PublisherSubsidyDayRecord> {
    const record: PublisherSubsidyDayRecord = {
      starting: starting,
      totalCoins: totalCoins,
      coinsPerPaidOpen: coinsPerPaidOpen,
      coinsPaid: 0,
      returnUserBonus: returnUserBonus
    };
    await this.publisherSubsidyDays.insert(record);
    return record;
  }

  async findLatestPublisherSubsidyDay(): Promise<PublisherSubsidyDayRecord> {
    const result = await this.publisherSubsidyDays.find().sort({ starting: -1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    } else {
      return null;
    }
  }

  async incrementLatestPublisherSubsidyPaid(starting: number, coinsPaid: number): Promise<void> {
    await this.publisherSubsidyDays.updateOne({ starting: starting }, { $inc: { coinsPaid: coinsPaid }, $set: { coinsPerPaidOpen: coinsPaid } });
  }

  async listCardTopics(): Promise<CardTopicRecord[]> {
    return this.cardTopics.find<CardTopicRecord>({ status: "active" }).sort({ topicWithCase: 1 }).toArray();
  }

  async findCardTopicByName(name: string): Promise<CardTopicRecord> {
    return this.cardTopics.findOne<CardTopicRecord>({ topicNoCase: name.toLowerCase() });
  }

  async insertOriginalNetworkCardStats(stats: NetworkCardStats, baseCardPrice: number): Promise<void> {
    const record: NetworkCardStatsHistoryRecord = {
      periodStarting: 0,
      isCurrent: false,
      stats: stats,
      baseCardPrice: baseCardPrice
    };
    await this.networkCardStats.insert(record);
  }

  async findLatestNetworkCardStats(): Promise<NetworkCardStatsHistoryRecord> {
    const records = await this.networkCardStats.find<NetworkCardStatsHistoryRecord>({}).sort({ periodStarting: -1 }).limit(1).toArray();
    if (records.length > 0) {
      return records[0];
    } else {
      return null;
    }
  }

  async ensureNetworkCardStats(force = false): Promise<NetworkCardStatsHistoryRecord> {
    let result = await this.networkCardStats.find<NetworkCardStatsHistoryRecord>({}).sort({ periodStarting: -1 }).limit(1).toArray();
    const now = Date.now();
    if (!force && result && result.length > 0 && now - result[0].periodStarting < NETWORK_CARD_STATS_SNAPSHOT_PERIOD) {
      return result[0];
    }
    const record = result[0];
    // We want to avoid multiple processes inserting duplicates, so we round the periodStarting to the nearest
    // 1 minute boundary.  Then if a second process tries to insert, it will get a duplicate error.
    const newPeriodStart = Math.round(now / (1000 * 60)) * (1000 * 60);
    const stats: NetworkCardStats = record && record.stats ? record.stats : this.createEmptyNetworkCardStats();
    if (!stats.paidUnits) {
      stats.paidUnits = 0;
    }
    const newRecord: NetworkCardStatsHistoryRecord = {
      periodStarting: newPeriodStart,
      isCurrent: true,
      stats: stats,
      baseCardPrice: await priceRegulator.calculateBaseCardPrice(record)
    };
    try {
      await this.networkCardStats.insertOne(newRecord);
      await this.networkCardStats.updateOne({ periodStarting: record.periodStarting }, { $set: { isCurrent: false } });
    } catch (err) {
      // May be race condition
      errorManager.warning("Db.ensureNetworkCardStats: record insert/update failed, ignoring because of probable race condition", null);
    }
    result = await this.networkCardStats.find<NetworkCardStatsHistoryRecord>({}).sort({ periodStarting: -1 }).limit(1).toArray();
    return result[0];
  }

  createEmptyNetworkCardStats(): NetworkCardStats {
    const stats: NetworkCardStats = {
      opens: 0,
      uniqueOpens: 0,
      clicks: 0,
      uniqueClicks: 0,
      paidOpens: 0,
      paidUnits: 0,
      likes: 0,
      dislikes: 0,
      reports: 0,
      refunds: 0,
      cardRevenue: 0,
      blockedPaidOpens: 0,
      firstTimePaidOpens: 0,
      fanPaidOpens: 0,
      grossRevenue: 0,
      weightedRevenue: 0,
      purchasers: 0,
      registrants: 0,
      publishers: 0,
      purchases: 0,
      cards: 0,
      cardPayments: 0,
      advertisers: 0,
      adCardsOpenOrClick: 0,
      adCardsImpression: 0,
      adPaidOpenOrClicks: 0,
      adPaidImpressions: 0,
      adImpressionRedemptions: 0,
      adOpenOrClickRedemptions: 0
    };
    return stats;
  }

  async getNetworkCardStatsAt(timestamp: number, allowCurrent = false): Promise<NetworkCardStatsHistoryRecord> {
    const query: any = { periodStarting: { $lt: timestamp } };
    if (allowCurrent) {
      query.isCurrent = false;
    }
    const result = await this.networkCardStats.find<NetworkCardStatsHistoryRecord>(query).sort({ periodStarting: -1 }).limit(1).toArray();
    if (result && result.length > 0) {
      return result[0];
    } else {
      return {
        periodStarting: 0,
        isCurrent: false,
        stats: this.createEmptyNetworkCardStats(),
        baseCardPrice: 0
      };
    }
  }

  async incrementNetworkCardStatItems(opens: number, uniqueOpens: number, paidOpens: number, paidUnits: number, likes: number, dislikes: number, clicks: number, uniqueClicks: number, blockedPaidOpens: number, firstTimePaidOpens: number, fanPaidOpens: number, grossRevenue: number, weightedRevenue: number, reports: number, refunds: number, purchasers: number, registrants: number, publishers: number, purchases: number, cards: number, cardPayments: number, advertisers: number, adCardsOpenOrClick: number, adCardsImpression: number, adPaidOpenOrClicks: number, adPaidImpressions: number, adImpressionRedemptions: number, adOpenOrClickRedemptions: number): Promise<void> {
    const update: any = {};
    if (opens) {
      update["stats.opens"] = opens;
    }
    if (uniqueOpens) {
      update["stats.uniqueOpens"] = uniqueOpens;
    }
    if (clicks) {
      update["stats.clicks"] = clicks;
    }
    if (uniqueClicks) {
      update["stats.uniqueClicks"] = uniqueClicks;
    }
    if (paidOpens) {
      update["stats.paidOpens"] = paidOpens;
    }
    if (paidUnits) {
      update["stats.paidUnits"] = paidOpens;
    }
    if (likes) {
      update["stats.likes"] = likes;
    }
    if (dislikes) {
      update["stats.dislikes"] = dislikes;
    }
    if (blockedPaidOpens) {
      update["stats.blockedPaidOpens"] = blockedPaidOpens;
    }
    if (firstTimePaidOpens) {
      update["stats.firstTimePaidOpens"] = firstTimePaidOpens;
    }
    if (fanPaidOpens) {
      update["stats.fanPaidOpens"] = fanPaidOpens;
    }
    if (grossRevenue) {
      update["stats.grossRevenue"] = grossRevenue;
    }
    if (weightedRevenue) {
      update["stats.weightedRevenue"] = weightedRevenue;
    }
    if (reports) {
      update["stats.reports"] = reports;
    }
    if (refunds) {
      update["stats.refunds"] = refunds;
    }
    if (purchasers) {
      update["stats.purchasers"] = purchasers;
    }
    if (purchases) {
      update["stats.purchases"] = purchases;
    }
    if (registrants) {
      update["stats.registrants"] = registrants;
    }
    if (publishers) {
      update["stats.publishers"] = publishers;
    }
    if (cards) {
      update["stats.cards"] = cards;
    }
    if (cardPayments) {
      update["stats.cardPayments"] = cardPayments;
    }
    if (advertisers) {
      update["stats.advertisers"] = advertisers;
    }
    if (adCardsOpenOrClick) {
      update["stats.adCardsOpenOrClick"] = adCardsOpenOrClick;
    }
    if (adCardsImpression) {
      update["stats.adCardsImpression"] = adCardsImpression;
    }
    if (adPaidOpenOrClicks) {
      update["stats.adPaidOpenOrClicks"] = adPaidOpenOrClicks;
    }
    if (adPaidImpressions) {
      update["stats.adPaidImpressions"] = adPaidImpressions;
    }
    if (adImpressionRedemptions) {
      update["stats.adImpressionRedemptions"] = adImpressionRedemptions;
    }
    if (adOpenOrClickRedemptions) {
      update["stats.adOpenOrClickRedemptions"] = adOpenOrClickRedemptions;
    }
    if (Object.keys(update).length === 0) {
      return;
    }
    let retries = 0;
    while (retries++ < 5) {
      const statsRecord = await this.ensureNetworkCardStats();
      const updateResult = await this.networkCardStats.updateOne({ periodStarting: statsRecord.periodStarting, isCurrent: true }, { $inc: update });
      if (updateResult.modifiedCount === 1) {
        return;
      }
    }
    errorManager.error("Db.incrementNetworkCardStatItems: Retries exhausted trying to update network card stats because of collisions", null);
  }

  async incrementNetworkCardStatBlockedOpens(periodStarting: number, blockedPaidOpens: number): Promise<void> {
    await this.networkCardStats.updateMany({ periodStarting: { $gte: periodStarting } }, { $inc: { "stats.blockedPaidOpens": blockedPaidOpens } });
  }

  async updateNetworkCardStatsForPayment(periodsStartingAfter: number, firstTimePaidOpens: number, fanPaidOpens: number, grossRevenue: number, weightedRevenue: number): Promise<void> {
    await this.networkCardStats.updateMany({ periodStarting: { $gte: periodsStartingAfter } }, {
      $inc: {
        "stats.firstTimePaidOpens": firstTimePaidOpens,
        "stats.fanPaidOpens": fanPaidOpens,
        "stats.grossRevenue": grossRevenue,
        "stats.weightedRevenue": weightedRevenue
      }
    });
  }

  async insertIpAddress(ipAddress: string, status: IpAddressStatus, country: string, countryCode: string, region: string, regionName: string, city: string, zip: string, lat: number, lon: number, timezone: string, isp: string, org: string, as: string, query: string, message: string): Promise<IpAddressRecord> {
    const now = Date.now();
    const record: IpAddressRecord = {
      ipAddress: ipAddress.toLowerCase(),
      created: now,
      lastUpdated: now,
      status: status,
      country: country,
      countryCode: countryCode,
      region: region,
      regionName: regionName,
      city: city,
      zip: zip,
      lat: lat,
      lon: lon,
      timezone: timezone,
      isp: isp,
      org: org,
      as: as,
      query: query,
      message: message
    };
    try {
      await this.ipAddresses.insertOne(record);
    } catch (err) {
      await this.ipAddresses.findOne<IpAddressRecord>({ ipAddress: ipAddress.toLowerCase() });
    }
    return record;
  }

  async findIpAddress(ipAddress: string): Promise<IpAddressRecord> {
    return this.ipAddresses.findOne<IpAddressRecord>({ ipAddress: ipAddress.toLowerCase() });
  }

  async findIpAddressCountryCode(countryCode: string): Promise<IpAddressRecord> {
    const records = await this.ipAddresses.find<IpAddressRecord>({ countryCode: countryCode }).sort({ created: -1 }).limit(1).toArray();
    return records.length > 0 ? records[0] : null;
  }

  async findIpAddressRegionCode(countryCode: string, regionCode: string): Promise<IpAddressRecord> {
    const records = await this.ipAddresses.find<IpAddressRecord>({ countryCode: countryCode, region: regionCode }).sort({ created: -1 }).limit(1).toArray();
    return records.length > 0 ? records[0] : null;
  }

  async findIpAddressDistinctRegions(countryCode: string): Promise<string> {
    return this.ipAddresses.distinct("region", { countryCode: countryCode });
  }

  async updateIpAddress(ipAddress: string, status: IpAddressStatus, country: string, countryCode: string, region: string, regionName: string, city: string, zip: string, lat: number, lon: number, timezone: string, isp: string, org: string, as: string, query: string, message: string): Promise<IpAddressRecord> {
    const now = Date.now();
    const update: any = {
      ipAddress: ipAddress.toLowerCase(),
      lastUpdated: now,
      status: status
    };
    if (country) {
      update.country = country;
    }
    if (countryCode) {
      update.countryCode = countryCode;
    }
    if (region) {
      update.region = region;
    }
    if (regionName) {
      update.regionName = regionName;
    }
    if (city) {
      update.city = city;
    }
    if (zip) {
      update.zip = zip;
    }
    if (lat) {
      update.lat = lat;
    }
    if (lon) {
      update.lon = lon;
    }
    if (timezone) {
      update.timezone = timezone;
    }
    if (isp) {
      update.isp = isp;
    }
    if (org) {
      update.org = org;
    }
    if (as) {
      update.as = as;
    }
    if (query) {
      update.query = query;
    }
    if (message) {
      update.message = message;
    }
    await this.ipAddresses.update({ ipAddress: ipAddress.toLowerCase() }, { $set: update });
    return this.findIpAddress(ipAddress);
  }

  async insertChannel(sessionId: string, handle: string, name: string, location: string, ownerId: string, bannerImageFileId: string, about: string, linkUrl: string, socialLinks: SocialLink[], latestCardPosted: number, firstCardPosted: number): Promise<ChannelRecord> {
    if (!socialLinks) {
      socialLinks = [];
    }
    const now = Date.now();
    const record: ChannelRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      state: 'active',
      handle: handle.toLowerCase(),
      name: name,
      ownerId: ownerId,
      created: now,
      bannerImageFileId: bannerImageFileId,
      about: about,
      linkUrl: linkUrl,
      socialLinks: socialLinks,
      stats: {
        subscribers: 0,
        cards: 0,
        revenue: 0
      },
      lastStatsSnapshot: 0,
      latestCardPosted: latestCardPosted,
      firstCardPosted: firstCardPosted,
      keywords: [],
      featuredWeight: 0,
      listingWeight: 0
    };
    await this.channels.insertOne(record);
    return record;
  }

  async findChannelById(id: string): Promise<ChannelRecord> {
    return this.channels.findOne<ChannelRecord>({ id: id });
  }

  async findChannelByHandle(handle: string): Promise<ChannelRecord> {
    return this.channels.findOne<ChannelRecord>({ handle: handle.toLowerCase() });
  }

  async findChannelsByOwnerId(ownerId: string): Promise<ChannelRecord[]> {
    return this.channels.find<ChannelRecord>({ ownerId: ownerId }).sort({ created: 1 }).toArray();
  }

  async findChannelsBySearch(searchText: string, skip: number, limit: number): Promise<ChannelRecord[]> {
    const query: any = {
      state: "active",
      $text: { $search: searchText }
    };
    return this.channels.find<ChannelRecord>(query, { searchScore: { $meta: "textScore" }, searchText: 0 }).sort({ searchScore: { $meta: "textScore" } }).skip(skip).limit(limit).toArray();
  }

  getChannelsByFirstPosted(firstPostedBefore: number): Cursor<ChannelRecord> {
    const query: any = {};
    query.firstCardPosted = firstPostedBefore ? { $lt: firstPostedBefore, $gt: 0 } : { $gt: 0 };
    return this.channels.find<ChannelRecord>(query).sort({ firstCardPosted: -1 });
  }

  getChannels(): Cursor<ChannelRecord> {
    return this.channels.find<ChannelRecord>().sort({ created: -1 });
  }

  getChannelsWithoutFirstCard(): Cursor<ChannelRecord> {
    return this.channels.find<ChannelRecord>({ firstCardPosted: 0 });
  }

  async findFeaturedChannels(state: ChannelStatus, limit: number): Promise<ChannelRecord[]> {
    return this.channels.find<ChannelRecord>({ state: state, featuredWeight: { $gt: 0 } }).sort({ featuredWeight: -1 }).limit(limit || 10).toArray();
  }

  async findListedChannels(state: ChannelStatus, limit: number): Promise<ChannelRecord[]> {
    return this.channels.find<ChannelRecord>({ state: state, listingWeight: { $gt: 0 } }).sort({ listingWeight: -1 }).limit(limit || 10).toArray();
  }

  async findOwnedChannelIds(ownerId: string): Promise<string[]> {
    return this.channels.distinct("id", { ownerId: ownerId });
  }

  async updateChannel(channelId: string, name: string, bannerImageFileId: string, about: string, linkUrl: string, socialLinks: SocialLink[]): Promise<void> {
    const update: any = {};
    if (typeof name !== 'undefined') {
      update.name = name;
    }
    if (typeof bannerImageFileId !== 'undefined') {
      update.bannerImageFileId = bannerImageFileId;
    }
    if (typeof about !== 'undefined') {
      update.about = about;
    }
    if (typeof linkUrl !== 'undefined') {
      update.linkUrl = linkUrl;
    }
    if (typeof socialLinks !== 'undefined') {
      update.socialLinks = socialLinks;
    }
    if (Object.keys(update).length === 0) {
      return;
    }
    await this.channels.updateOne({ id: channelId }, { $set: update });
  }

  async incrementChannelStat(channelId: string, statName: string, incrementBy: number): Promise<void> {
    const inc: any = {};
    inc["stats." + statName] = incrementBy;
    await this.channels.updateOne({ id: channelId }, { $inc: inc });
  }

  async updateChannelLatestCardPosted(channelId: string, cardPostedAt: number): Promise<void> {
    await this.channels.updateOne({ id: channelId }, { $set: { latestCardPosted: cardPostedAt } });
  }

  async updateChannelFirstCardPosted(channelId: string, cardPostedAt: number): Promise<void> {
    await this.channels.updateOne({ id: channelId }, { $set: { firstCardPosted: cardPostedAt } });
  }

  async updateChannelWithKeywords(channelId: string, keywords: string[]): Promise<void> {
    await this.channels.updateOne({ id: channelId }, { $set: { keywords: keywords } });
  }

  async updateChannelAdmin(channelId: string, featuredWeight: number, listingWeight: number): Promise<void> {
    await this.channels.updateOne({ id: channelId }, { $set: { featuredWeight: featuredWeight, listingWeight: listingWeight } });
  }

  async findChannelUser(channelId: string, userId: string, subscriptionState: ChannelSubscriptionState): Promise<ChannelUserRecord> {
    const query: any = { channelId: channelId, userId: userId };
    if (subscriptionState) {
      query.subscriptionState = subscriptionState;
    }
    return this.channelUsers.findOne<ChannelUserRecord>(query);
  }

  async countAllChannelUserBonusesPaid(): Promise<number> {
    return this.channelUsers.count({ bonusPaid: { $exists: true } });
  }

  async countChannelUserReferralBonuses(channelId: string): Promise<number> {
    return this.channelUsers.count({ channelId: channelId, bonusPaid: { $exists: true } });
  }

  async existsChannelUserSubscriptions(userId: string, channelIds: string[], subscriptionState: ChannelSubscriptionState): Promise<boolean> {
    const result = await this.channelUsers.find<ChannelUserRecord>({ userId: userId, channelId: { $in: channelIds }, subscriptionState: subscriptionState }).limit(1).toArray();
    return result.length > 0;
  }

  async findChannelSubscribers(channelId: string, subscriptionState: ChannelSubscriptionState, maxCount: number, lastUpdatedBefore: number): Promise<ChannelUserRecord[]> {
    const query: any = { channelId: channelId, subscriptionState: subscriptionState };
    if (lastUpdatedBefore) {
      query.lastUpdated = { $lt: lastUpdatedBefore };
    }
    return this.channelUsers.find<ChannelUserRecord>(query).sort({ lastUpdated: -1 }).limit(maxCount || 100).toArray();
  }

  async upsertChannelUser(channelId: string, userId: string, sessionId: string, subscriptionState: ChannelSubscriptionState, lastCardPosted: number, lastVisited: number): Promise<ChannelUserRecord> {
    const now = Date.now();
    const record: ChannelUserRecord = {
      channelId: channelId,
      userId: userId,
      sessionId: sessionId,
      added: now,
      lastCardPosted: lastCardPosted,
      subscriptionState: subscriptionState,
      lastUpdated: now,
      notificationPending: false,
      lastNotification: 0,
      lastVisited: lastVisited
    };
    await this.channelUsers.update({ channelId: channelId, userId: userId }, record, { upsert: true });
    return record;
  }

  async updateChannelUser(channelId: string, userId: string, subscriptionState: ChannelSubscriptionState, channelLatestCard: number, lastVisited: number): Promise<void> {
    await this.channelUsers.updateOne({ channelId: channelId, userId: userId }, {
      $set: {
        subscriptionState: subscriptionState,
        lastUpdated: Date.now(),
        channelLatestCard: channelLatestCard,
        lastVisited: lastVisited
      }
    });
  }

  async updateChannelUserBonus(channelId: string, userId: string, bonusPaid: number, bonusPaidAt: number, bonusFraudDetected: boolean): Promise<void> {
    await this.channelUsers.updateOne({ channelId: channelId, userId: userId }, {
      $set: {
        bonusPaid: bonusPaid,
        bonusPaidAt: bonusPaidAt,
        bonusFraudDetected: bonusFraudDetected
      }
    });
  }

  async updateChannelUsersForLatestUpdate(channelId: string, cardLastPosted: number): Promise<void> {
    await this.channelUsers.updateMany({ channelId: channelId, channelLastUpdate: { $lt: cardLastPosted } }, { $set: { channelLastUpdate: cardLastPosted, notificationPending: true } });
  }

  async updateChannelUserLastVisit(channelId: string, userId: string, lastVisited: number): Promise<void> {
    await this.channelUsers.updateOne({ channelId: channelId, userId: userId }, { $set: { lastVisited: lastVisited } });
  }

  async updateChannelUserNotificationSent(userId: string, channelIds: string[]) {
    if (channelIds.length === 0) {
      return;
    }
    await this.channelUsers.updateMany({ channelId: { $in: channelIds }, userId: userId }, { $set: { lastNotification: Date.now(), notificationPending: false } });
  }

  async findChannelUserRecords(userId: string, subscriptionState: ChannelSubscriptionState, maxCount: number, latestLessThan: number, latestGreaterThan: number): Promise<ChannelUserRecord[]> {
    return this.getChannelUserRecords(userId, subscriptionState, latestLessThan, latestGreaterThan).limit(maxCount || 100).toArray();
  }

  async findChannelUserRecordsForward(userId: string, subscriptionState: ChannelSubscriptionState, maxCount: number): Promise<ChannelUserRecord[]> {
    return this.channelUsers.find<ChannelUserRecord>({ userId: userId, subscriptionState: subscriptionState }).sort({ added: 1 }).limit(maxCount || 10).toArray();
  }

  getChannelUserSubscribers(channelId: string): Cursor<ChannelUserRecord> {
    return this.channelUsers.find<ChannelUserRecord>({ channelId: channelId, subscriptionState: "subscribed" });
  }

  async countDistinctSubscribersInChannels(channelIds: string[]): Promise<number> {
    if (channelIds.length === 0) {
      return 0;
    }
    const userIds = await this.channelUsers.distinct("userId", { channelId: { $in: channelIds }, subscriptionState: "subscribed" });
    return userIds.length;
  }

  getChannelUserRecords(userId: string, subscriptionState: ChannelSubscriptionState, latestLessThan: number, latestGreaterThan: number): Cursor<ChannelUserRecord> {
    const query: any = { userId: userId, subscriptionState: subscriptionState };
    if (latestLessThan) {
      query.channelLatestCard = { $lte: latestLessThan, $gt: latestGreaterThan || 0 };
    } else if (latestGreaterThan) {
      query.channelLatestCard = { $gt: latestGreaterThan };
    }
    return this.channelUsers.find<ChannelUserRecord>(query).sort({ channelLatestCard: -1 });
  }

  getChannelUserPendingNotifications(): Cursor<ChannelUserRecord> {
    return this.channelUsers.find<ChannelUserRecord>({ notificationPending: true }).sort({ lastCardPosted: -1 });
  }

  async ensureChannelCard(channelId: string, cardId: string, sessionId: string): Promise<ChannelCardRecord> {
    let record = await this.channelCards.findOne<ChannelCardRecord>({ channelId: channelId, cardId: cardId });
    if (record) {
      return record;
    }
    const now = Date.now();
    record = {
      channelId: channelId,
      cardId: cardId,
      sessionId: sessionId,
      state: 'inactive',
      cardPostedAt: 0,
      added: 0,
      removed: 0,
      pinned: false,
      pinPriority: 0
    };
    await this.channelCards.insertOne(record);
    return record;
  }

  async findChannelCard(channelId: string, cardId: string, includeInactive = false): Promise<ChannelCardRecord> {
    const query = includeInactive ? { channelId: channelId, cardId: cardId } : { state: 'active', channelId: channelId, cardId: cardId };
    return this.channelCards.findOne<ChannelCardRecord>(query);
  }

  // async findChannelCardFirstByChannel(channelId: string): Promise<ChannelCardRecord> {
  //   const result = await this.channelCards.find<ChannelCardRecord>({ state: 'active', channelId: channelId }).sort({ cardPostedAt: 1 }).limit(1).toArray();
  //   if (result.length > 0) {
  //     return result[0];
  //   } else {
  //     return null;
  //   }
  // }

  async findChannelCardsByCard(cardId: string, maxCount: number): Promise<ChannelCardRecord[]> {
    if (maxCount === 0) {
      return [];
    }
    return this.getChannelCardsByCard(cardId).limit(maxCount || 100).toArray();
  }

  getChannelCardsByCard(cardId: string): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', cardId: cardId };
    return this.channelCards.find<ChannelCardRecord>(query);
  }

  async addChannelCard(channelId: string, cardId: string, cardPostedAt: number): Promise<void> {
    const update: any = {
      state: 'active',
      added: Date.now(),
      cardPostedAt: cardPostedAt
    };
    await this.channelCards.updateOne({ channelId: channelId, cardId: cardId }, { $set: update });
  }

  async removeChannelCard(channelId: string, cardId: string): Promise<void> {
    await this.channelCards.updateOne({ state: 'active', channelId: channelId, cardId: cardId }, {
      $set: {
        state: 'inactive',
        removed: Date.now()
      }
    });
  }

  async removeChannelCardsByCard(cardId: string): Promise<void> {
    await this.channelCards.updateMany({ state: 'active', cardId: cardId }, {
      $set: {
        state: 'inactive',
        removed: Date.now()
      }
    });
  }

  // async findChannelCardsByChannel(channelId: string, since: number, maxCount: number): Promise<ChannelCardRecord[]> {
  //   if (maxCount === 0) {
  //     return [];
  //   }
  //   return this.getChannelCardsByChannel(channelId, since).limit(maxCount || 100).toArray();
  // }

  getChannelCardsAllInChannels(channelIds: string[], before: number, after: number): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: { $in: channelIds } };
    const cardPostedAt: any = { $gt: after };
    if (before && after) {
      query.cardPostedAt = { $gt: after, $lte: before };
    } else if (before) {
      query.cardPostedAt = { $lte: before };
    } else if (after) {
      query.cardPostedAt = { $gt: after };
    }
    return this.channelCards.find<ChannelCardRecord>(query).sort({ cardPostedAt: -1 });
  }

  getChannelCardsPinnedInChannels(channelIds: string[]): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: { $in: channelIds }, pinned: true };
    return this.channelCards.find<ChannelCardRecord>(query).sort({ pinPriority: -1, cardPostedAt: -1 });
  }

  getChannelCardsUnpinnedInChannels(channelIds: string[], before: number, after: number): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: { $in: channelIds }, pinned: false };
    const cardPostedAt: any = { $gt: after };
    if (before && after) {
      query.cardPostedAt = { $gt: after, $lte: before };
    } else if (before) {
      query.cardPostedAt = { $lte: before };
    } else if (after) {
      query.cardPostedAt = { $gt: after };
    }
    return this.channelCards.find<ChannelCardRecord>(query).sort({ cardPostedAt: -1 });
  }

  getChannelCardsPinnedByChannel(channelId: string): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: channelId, pinned: true };
    return this.channelCards.find<ChannelCardRecord>(query).sort({ pinPriority: -1 });
  }

  getChannelCardsUnpinnedByChannel(channelId: string, since: number): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: channelId, pinned: false };
    if (since) {
      query.since = { $gte: since };
    }
    return this.channelCards.find<ChannelCardRecord>(query).sort({ cardPostedAt: -1 });
  }

  getChannelCardsUnpinnedInChannel(channelId: string, before: number, after: number): Cursor<ChannelCardRecord> {
    const query: any = { state: 'active', channelId: channelId, pinned: false };
    const cardPostedAt: any = { $gt: after };
    if (before && after) {
      query.cardPostedAt = { $gt: after, $lte: before };
    } else if (before) {
      query.cardPostedAt = { $lte: before };
    } else if (after) {
      query.cardPostedAt = { $gt: after };
    }
    return this.channelCards.find<ChannelCardRecord>(query).sort({ cardPostedAt: -1 });
  }

  async updateChannelCardPinning(channelId: string, cardId: string, pinned: boolean, pinPriority: number): Promise<void> {
    await this.channelCards.updateOne({ channelId: channelId, cardId: cardId }, { $set: { pinned: pinned, pinPriority: pinPriority } });
  }

  async insertUserRegistration(userId: string, ipAddress: string, fingerprint: string, isMobile: boolean, address: string, referrer: string, landingPage: string, userAgent: string, referringUserId: string): Promise<UserRegistrationRecord> {
    const record: UserRegistrationRecord = {
      sessionId: uuid.v4(),
      userId: userId,
      at: Date.now(),
      ipAddress: ipAddress ? ipAddress.toLowerCase() : null,
      fingerprint: fingerprint,
      isMobile: isMobile,
      address: address,
      referrer: referrer,
      landingPage: landingPage,
      userAgent: userAgent,
      referringUserId: referringUserId
    };
    await this.userRegistrations.insertOne(record);
    return record;
  }

  async existsUserRegistrationByFingerprint(userId: string, fingerprint: string, mobile: boolean, ipAddress: string): Promise<boolean> {
    const query: any = { userId: userId, fingerprint: fingerprint };
    if (mobile) {
      query.ipAddress = ipAddress;
    }
    const record = await this.userRegistrations.find<UserRegistrationRecord>(query).limit(1).toArray();
    return record.length > 0 ? true : false;
  }

  async findUserRegistrationDistinctFingerprints(userId: string): Promise<string[]> {
    return this.userRegistrations.distinct('fingerprint', { mobile: false, userId: userId, fingerprint: { $ne: null } });
  }

  async findUserIdsByFingerprint(fingerprints: string[]): Promise<string[]> {
    return this.userRegistrations.distinct('userId', { fingerprint: { $in: fingerprints } });
  }

  async findUserRegistrationBySessionId(sessionId: string): Promise<UserRegistrationRecord> {
    return this.userRegistrations.findOne<UserRegistrationRecord>({ sessionId: sessionId });
  }

  async existsFingerprint(fingerprint: string): Promise<boolean> {
    const existing = await this.userRegistrations.findOne<UserRegistrationRecord>({ fingerprint: fingerprint });
    return existing ? true : false;
  }

  async existsFingerprintAndIpAddress(fingerprint: string, ipAddress: string): Promise<boolean> {
    const existing = await this.userRegistrations.findOne<UserRegistrationRecord>({ fingerprint: fingerprint, ipAddress: ipAddress });
    return existing ? true : false;
  }

  async insertChannelKeyword(channelId: string, keyword: string, cardCount: number, lastUsed: number): Promise<ChannelKeywordRecord> {
    const record: ChannelKeywordRecord = {
      channelId: channelId,
      keyword: keyword.toLowerCase(),
      cardCount: cardCount,
      lastUsed: lastUsed
    };
    await this.channelKeywords.insertOne(record);
    return record;
  }

  async findChannelKeyword(channelId: string, keyword: string): Promise<ChannelKeywordRecord> {
    return this.channelKeywords.findOne<ChannelKeywordRecord>({ channelId: channelId, keyword: keyword.toLowerCase() });
  }

  async findChannelKeywords(channelId: string, limit: number): Promise<ChannelKeywordRecord[]> {
    return this.channelKeywords.find<ChannelKeywordRecord>({ channelId: channelId }).sort({ cardCount: -1, lastUsed: -1 }).limit(limit).toArray();
  }

  async updateChannelKeyword(channelId: string, keyword: string, incrementCardCountBy: number, lastUsed: number): Promise<void> {
    const update: any = {
      $inc: { cardCount: incrementCardCountBy }
    };
    if (lastUsed) {
      update.$set = { lastUsed: lastUsed };
    }
    await this.channelKeywords.updateOne({ channelId: channelId, keyword: keyword.toLowerCase() }, update);
  }

  async insertAdSlot(sessionId: string, userId: string, userGeo: GeoLocation, geoTargets: string[], userBalance: number, channelId: string, cardId: string, cardCampaignId: string, type: AdSlotType, authorId: string, amount: number): Promise<AdSlotRecord> {
    const now = Date.now();
    const record: AdSlotRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      userId: userId,
      userBalance: userBalance,
      channelId: channelId,
      cardId: cardId,
      cardCampaignId: cardCampaignId,
      created: now,
      authorId: authorId,
      type: type,
      status: "pending",
      redeemed: false,
      statusChanged: now,
      amount: amount,
      userGeo: userGeo,
      geoTargets: geoTargets
    };
    await this.adSlots.insertOne(record);
    return record;
  }

  async findAdSlotById(id: string): Promise<AdSlotRecord> {
    return this.adSlots.findOne<AdSlotRecord>({ id: id });
  }

  getAdSlotsMissingGeo(since: number): Cursor<AdSlotRecord> {
    return this.adSlots.find<AdSlotRecord>({
      created: { $gt: since },
      geo: { $exists: false }
    });
  }

  async countAdSlotsSince(since: number): Promise<number> {
    return this.adSlots.count({ status: { $ne: "pending" }, created: { $gt: since } });
  }

  async countAdSlotsInGeosSince(geoTargets: string[], since: number): Promise<number> {
    return this.adSlots.count({ status: { $ne: "pending" }, created: { $gt: since }, geoTargets: { $in: geoTargets } });
  }

  async updateAdSlotGeo(id: string, geo: GeoLocation, geoTargets: string[]): Promise<void> {
    await this.adSlots.updateOne({ id: id }, {
      $set: {
        geo: geo,
        geoTargets: geoTargets
      }
    });
  }

  async updateAdSlot(id: string, status: AdSlotStatus, redeemed: boolean): Promise<void> {
    const update: any = {
      status: status,
      statusChanged: Date.now()
    };
    if (redeemed) {
      update.redeemed = true;
    }
    await this.adSlots.updateOne({ id: id }, { $set: update });
  }

  async insertCardComment(sessionId: string, byId: string, at: number, cardId: string, text: string, metadata: CardCommentMetadata, curation: CommentCurationType): Promise<CardCommentRecord> {
    const now = Date.now();
    const record: CardCommentRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      byId: byId,
      at: at,
      cardId: cardId,
      text: text,
      metadata: metadata,
      curation: curation
    };
    await this.cardComments.insertOne(record);
    return record;
  }

  async findCardCommentById(id: string): Promise<CardCommentRecord> {
    return this.cardComments.findOne<CardCommentRecord>({ id: id });
  }

  getCardCommentsForCard(cardId: string, before: number, since: number, byId: string): Cursor<CardCommentRecord> {
    const query: any = {
      cardId: cardId
    };
    query.$or = [
      { curation: { $ne: "blocked" } },
      { byId: byId },
    ];
    if (before && since) {
      query.at = { $lt: before, $gt: since };
    } else if (before) {
      query.at = { $lt: before };
    } else if (since) {
      query.at = { $gt: since };
    }
    return this.cardComments.find<CardCommentRecord>(query).sort({ at: -1 });
  }

  async findCardCommentsRecent(maxCount: number): Promise<CardCommentRecord[]> {
    return this.cardComments.find<CardCommentRecord>().sort({ at: -1 }).limit(maxCount || 100).toArray();
  }

  async countCardComments(cardId: string, byId: string, before = 0): Promise<number> {
    const query: any = { cardId: cardId };
    if (byId) {
      query.$or = [
        { curation: { $ne: "blocked" } },
        { byId: byId },
      ];
    }
    if (before) {
      query.at = { $lt: before };
    }
    return this.cardComments.count(query);
  }

  async updateCardCommentCuration(commentId: string, curation: CommentCurationType): Promise<void> {
    await this.cardComments.updateOne({ id: commentId }, { $set: { curation: curation } });
  }

  async updateCardCommentCurationForUser(userId: string, curation: CommentCurationType): Promise<void> {
    await this.cardComments.updateMany({ byId: userId }, { $set: { curation: curation } });
  }

  async binUsersByAddedDate(periodsStarting: number[]): Promise<BinnedUserData[]> {
    return this.users.aggregate<BinnedUserData>([
      { $match: { type: 'normal', admin: false } },
      {
        $project: {
          added: "$added",
          balance: { $max: [{ $subtract: ["$balance", 5] }, 0] },
          withIdentity: { $cond: { if: { $eq: ["$identity.handle", undefined] }, then: 0, else: 1 } },
          returning: { $cond: { if: { $gt: [{ $subtract: ["$lastContact", "$added"] }, 43200000] }, then: 1, else: 0 } },
          publisher: { $cond: { if: { $gt: ["$lastPosted", 0] }, then: 1, else: 0 } },
          storage: "$storage"
        }
      },

      {
        $bucket: {
          groupBy: "$added",
          boundaries: periodsStarting,
          default: -1,
          output: {
            newUsers: { $sum: 1 },
            newUsersWithIdentity: { $sum: "$withIdentity" },
            totalBalance: { $sum: "$balance" },
            totalBalanceWithIdentity: { $sum: { $multiply: ["$balance", "$withIdentity"] } },
            returning: { $sum: "$returning" },
            returningWithIdentity: { $sum: { $multiply: ["$withIdentity", "$returning"] } },
            publishers: { $sum: "$publisher" },
            storage: { $sum: "$storage" }
          }
        }
      }
    ]).toArray();
  }

  async binCardsByDate(periodsStarting: number[]): Promise<BinnedCardData[]> {
    return this.cards.aggregate<BinnedCardData>([
      { $match: { type: "normal" } },
      {
        $project: {
          postedAt: "$postedAt",
          deleted: { $cond: { if: { $eq: ["$state", "active"] }, then: 0, else: 1 } },
          private: { $cond: { if: "$private", then: 1, else: 0 } },
          blocked: { $cond: { if: "$curation.block", then: 1, else: 0 } },
          ad: { $cond: { if: { $eq: ["$pricing.openFeeUnits", 0] }, then: 1, else: 0 } },
          budget: "$budget.amount",
          spent: "$budget.spent",
          revenue: "$stats.revenue.value",
          refunds: "$stats.refunds.value",
        }
      },
      {
        $bucket: {
          groupBy: "$postedAt",
          boundaries: periodsStarting,
          default: -1,
          output: {
            total: { $sum: 1 },
            deleted: { $sum: "$deleted" },
            private: { $sum: "$private" },
            blocked: { $sum: "$blocked" },
            ads: { $sum: "$ad" },
            budget: { $sum: "$budget" },
            spent: { $sum: "$spent" },
            revenue: { $sum: "$revenue" },
            refunds: { $sum: "$refunds" }
          }
        }
      }
    ]).toArray();
  }

  async binCardPayments(periodsStarting: number[]): Promise<BinnedPaymentData[]> {
    return this.userCardActions.aggregate([
      { $match: { action: "pay" } },
      {
        $project: {
          at: "$at",
          firstTime: { $cond: { if: { $eq: ["$payment.category", "first"] }, then: 0, else: 1 } },
          normal: { $cond: { if: { $eq: ["$payment.category", "normal"] }, then: 0, else: 1 } },
          fan: { $cond: { if: { $eq: ["$payment.category", "fan"] }, then: 0, else: 1 } },
          fraud: { $cond: { if: { $eq: ["$payment.category", "fraud"] }, then: 0, else: 1 } },
          amount: "$payment.amount",
          weightedRevenue: "$payment.weightedRevenue",
          userId: "$userId",
          authorId: "$authorId"
        }
      },
      {
        $bucket: {
          groupBy: "$at",
          boundaries: periodsStarting,
          default: -1,
          output: {
            total: { $sum: 1 },
            firstTime: { $sum: "$firstTime" },
            normal: { $sum: "$normal" },
            fan: { $sum: "$fan" },
            fraud: { $sum: "$fraud" },
            revenue: { $sum: "$amount" },
            weightedRevenue: { $sum: "$weightedRevenue" },
            purchasers: { $addToSet: "$userId" },
            sellers: { $addToSet: "$authorId" }
          }
        }
      },
      {
        $project: {
          total: "$total",
          firstTime: "$firstTime",
          normal: "$normal",
          fan: "$fan",
          fraud: "$fraud",
          revenue: "$revenue",
          weightedRevenue: "$weightedRevenue",
          purchasers: { $size: "$purchasers" },
          sellers: { $size: "$sellers" }
        }
      }
    ]).toArray();
  }

  async binAdSlots(periodsStarting: number[]): Promise<BinnedAdSlotData[]> {
    return this.adSlots.aggregate([
      { $match: { status: { $ne: "pending" } } },
      {
        $project: {
          created: "$created",
          impressionAd: { $cond: { if: { $eq: ["$type", "impression-ad"] }, then: 1, else: 0 } },
          impressionContent: { $cond: { if: { $eq: ["$type", "impression-content"] }, then: 1, else: 0 } },
          openPayment: { $cond: { if: { $eq: ["$type", "open-payment"] }, then: 1, else: 0 } },
          clickPayment: { $cond: { if: { $eq: ["$type", "click-payment"] }, then: 1, else: 0 } },
          announcement: { $cond: { if: { $eq: ["$type", "announcement"] }, then: 1, else: 0 } },
          impression: { $cond: { if: { $eq: ["$status", "impression"] }, then: 1, else: 0 } },
          opened: { $cond: { if: { $eq: ["$status", "opened"] }, then: 1, else: 0 } },
          openPaid: { $cond: { if: { $eq: ["$status", "open-paid"] }, then: 1, else: 0 } },
          clicked: { $cond: { if: { $eq: ["$status", "clicked"] }, then: 1, else: 0 } },
          redemptionFailed: { $cond: { if: { $eq: ["$status", "redemption-failed"] }, then: 1, else: 0 } },
          impressionsAmount: { $cond: { if: { $and: [{ $eq: ["$status", "impression"] }, "$redeemed"] }, then: "$amount", else: 0 } },
          opensAmount: { $cond: { if: { $and: [{ $eq: ["$status", "open-paid"] }, "$redeemed"] }, then: "$amount", else: 0 } },
          clicksAmount: { $cond: { if: { $and: [{ $eq: ["$status", "clicked"] }, "$redeemed"] }, then: "$amount", else: 0 } },
          userId: "$userId",
          authorId: "$authorId"
        }
      },
      {
        $bucket: {
          groupBy: "$created",
          boundaries: periodsStarting,
          default: -1,
          output: {
            total: { $sum: 1 },
            impressionAd: { $sum: "$impressionAd" },
            impressionContent: { $sum: "$impressionContent" },
            openPayment: { $sum: "$openPayment" },
            clickPayment: { $sum: "$clickPayment" },
            announcement: { $sum: "$announcement" },
            impression: { $sum: "$impression" },
            opened: { $sum: "$opened" },
            openPaid: { $sum: "$openPaid" },
            clicked: { $sum: "$clicked" },
            redemptionFailed: { $sum: "$redemptionFailed" },
            impressionsRevenue: { $sum: "$impressionsAmount" },
            opensRevenue: { $sum: "$opensAmount" },
            clicksRevenue: { $sum: "$clicksAmount" },
            consumers: { $addToSet: "$userId" },
            advertisers: { $addToSet: "$authorId" }
          }
        }
      },
      {
        $project: {
          total: "$total",
          impressionAd: "$impressionAd",
          impressionContent: "$impressionContent",
          openPayment: "$openPayment",
          clickPayment: "$clickPayment",
          announcement: "$announcement",
          impression: "$impression",
          opened: "$opened",
          openPaid: "$openPaid",
          clicked: "$clicked",
          redemptionFailed: "$redemptionFailed",
          impressionsRevenue: "$impressionsRevenue",
          opensRevenue: "$opensRevenue",
          clicksRevenue: "$clicksRevenue",
          consumers: { $size: "$consumers" },
          advertisers: { $size: "$advertisers" }
        }
      }
    ]).toArray();
  }

  async aggregateUserStats(): Promise<AdminUserStats> {
    const result: AdminUserStats = {
      total: 0,
      newUsers: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newUsersWithIdentity: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      totalWithIdentity: 0,
      totalStaleWithIdentity: 0,
      excessBalance: 0
    };
    const lastWeek = Date.now() - 1000 * 60 * 60 * 24 * 7;
    const twoWeeksAgo = Date.now() - 1000 * 60 * 60 * 24 * 14;
    const totals: any = await this.users.aggregate([
      {
        $group: {
          _id: "all",
          total: { $sum: 1 },
          withIdentity: { $sum: { $cond: { if: { $gt: ["$identity.handle", null] }, then: 1, else: 0 } } },
          staleWithIdentity: {
            $sum: {
              $cond: {
                if: {
                  $and: [
                    { $gt: ["$identity.handle", null] },
                    { $lt: ["$lastContact", twoWeeksAgo] }
                  ]
                },
                then: 1,
                else: 0
              }
            },
          },
          excessBalance: { $sum: { $max: [0, { $subtract: ["$balance", 5] }] } },
        }
      }
    ]).toArray();
    result.total = totals.length > 0 ? totals[0].total : 0;
    result.totalWithIdentity = totals.length > 0 ? totals[0].withIdentity : 0;
    result.totalStaleWithIdentity = totals.length > 0 ? totals[0].staleWithIdentity : 0;
    result.excessBalance = totals.length > 0 ? Utils.roundToDecimal(totals[0].excessBalance, 2) : 0;
    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const newUsersInfo: any = await this.users.aggregate([
      { $match: { added: { $gt: +previousMonth } } },
      {
        $bucket: {
          groupBy: "$added",
          boundaries: buckets,
          default: -1,
          output: {
            newUsers: { $sum: 1 },
            newUsersWithIdentity: { $sum: { $cond: { if: { $gt: ["$identity.handle", null] }, then: 1, else: 0 } } },
          }
        }
      }
    ]).toArray();
    for (const item of newUsersInfo) {
      if (item._id === +midnightToday) {
        result.newUsers.today = item.newUsers;
        result.newUsersWithIdentity.today = item.newUsersWithIdentity;
      } else if (item._id === +yesterday) {
        result.newUsers.yesterday = item.newUsers;
        result.newUsersWithIdentity.yesterday = item.newUsersWithIdentity;
      } else if (item._id === +previousWeek) {
        result.newUsers.priorWeek = item.newUsers;
        result.newUsersWithIdentity.priorWeek = item.newUsersWithIdentity;
      } else if (item._id === +previousMonth) {
        result.newUsers.priorMonth = item.newUsers;
        result.newUsersWithIdentity.priorMonth = item.newUsersWithIdentity;
      }
    }
    return result;
  }

  async aggregateNewUserStats(): Promise<AdminActiveUserStats> {
    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const results = await this.userRegistrations.aggregate([
      {
        $bucket: {
          groupBy: "$at",
          boundaries: buckets,
          default: -1,
          output: {
            count: { $sum: 1 },
            userIds: { $addToSet: "$userId" }
          }
        }
      },
      { $lookup: { from: "users", localField: "userIds", foreignField: "id", as: "user" } },
      { $unwind: "$user" },
      {
        $project: {
          userId: "$user.id",
          withIdentity: { $cond: { if: { $gt: ["$user.identity.handle", null] }, then: 1, else: 0 } },
          returning: {
            $cond: {
              if: {
                $gt: [
                  { $subtract: ["$user.lastContact", "$user.added"] },
                  43200000
                ]
              },
              then: 1,
              else: 0
            }
          },
          returningWithIdentity: {
            $cond: {
              if: {
                $and: [
                  { $gt: [{ $subtract: ["$user.lastContact", "$user.added"] }, 43200000] },
                  { $gt: ["$user.identity.handle", null] }]
              },
              then: 1,
              else: 0
            }
          }
        }
      },
      { $group: { _id: "$_id", users: { $sum: 1 }, withIdentity: { $sum: "$withIdentity" }, returning: { $sum: "$returning" }, returningWithIdentity: { $sum: "$returningWithIdentity" } } }
    ]).toArray();
    const result: AdminActiveUserStats = {
      total: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      withIdentity: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      returning: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      returningWithIdentity: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 }
    };
    for (const item of results) {
      if (item._id === +midnightToday) {
        result.total.today = item.users;
        result.withIdentity.today = item.withIdentity;
        result.returning.today = item.returning;
        result.returningWithIdentity.today = item.returningWithIdentity;
      } else if (item._id === +yesterday) {
        result.total.yesterday = item.users;
        result.withIdentity.yesterday = item.withIdentity;
        result.returning.yesterday = item.returning;
        result.returningWithIdentity.yesterday = item.returningWithIdentity;
      } else if (item._id === +previousWeek) {
        result.total.priorWeek = item.users;
        result.withIdentity.priorWeek = item.withIdentity;
        result.returning.priorWeek = item.returning;
        result.returningWithIdentity.priorWeek = item.returningWithIdentity;
      } else if (item._id === +previousMonth) {
        result.total.priorMonth = item.users;
        result.withIdentity.priorMonth = item.withIdentity;
        result.returning.priorMonth = item.returning;
        result.returningWithIdentity.priorMonth = item.returningWithIdentity;
      }
    }
    return result;
  }

  async aggregateCardStats(): Promise<AdminCardStats> {
    const info = await this.cards.aggregate([
      {
        $group: {
          _id: "all",
          total: { $sum: 1 },
          budget: { $sum: "$budget.amount" },
          spent: { $sum: "$budget.spent" },
          revenue: { $sum: "$stats.revenue.value" }
        }
      }
    ]).toArray();
    const result: AdminCardStats = {
      total: info.length > 0 ? info[0].total : 0,
      budget: info.length > 0 ? Utils.roundToDecimal(info[0].budget, 2) : 0,
      spent: info.length > 0 ? Utils.roundToDecimal(info[0].spent, 2) : 0,
      revenue: info.length > 0 ? Utils.roundToDecimal(info[0].revenue, 2) : 0,
      newCards: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 }
    };
    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const results = await this.cards.aggregate([
      {
        $bucket: {
          groupBy: "$postedAt",
          boundaries: buckets,
          default: -1,
          output: {
            count: { $sum: 1 }
          }
        }
      }
    ]).toArray();
    for (const item of results) {
      if (item._id === +midnightToday) {
        result.newCards.today = item.count;
      } else if (item._id === +yesterday) {
        result.newCards.yesterday = item.count;
      } else if (item._id === +previousWeek) {
        result.newCards.priorWeek = item.count;
      } else if (item._id === +previousMonth) {
        result.newCards.priorMonth = item.count;
      }
    }
    return result;
  }

  async aggregatePurchaseStats(): Promise<AdminPurchaseStats> {
    const info = await this.userCardActions.aggregate([
      { $match: { action: "pay" } },
      {
        $group: {
          _id: "all",
          total: { $sum: 1 },
          totalRevenue: { $sum: "$payment.amount" },
          totalFraud: { $sum: { $cond: { if: { $eq: ["$payment.category", "fraud"] }, then: 1, else: 0 } } },
          totalFirstTime: { $sum: { $cond: { if: { $eq: ["$payment.category", "first"] }, then: 1, else: 0 } } },
        }
      }
    ]).toArray();
    const result: AdminPurchaseStats = {
      total: info.length > 0 ? info[0].total : 0,
      totalRevenue: info.length > 0 ? Utils.roundToDecimal(info[0].totalRevenue, 2) : 0,
      totalFirstTime: info.length > 0 ? info[0].totalFirstTime : 0,
      totalFraud: info.length > 0 ? info[0].totalFraud : 0,
      newPurchases: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newRevenue: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newWeightedRevenue: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newFirstTime: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      fraud: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      purchasers: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      sellers: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
    };
    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const results = await this.userCardActions.aggregate([
      { $match: { action: "pay" } },
      {
        $bucket: {
          groupBy: "$at",
          boundaries: buckets,
          default: -1,
          output: {
            purchases: { $sum: 1 },
            revenue: { $sum: "$payment.amount" },
            weightedRevenue: { $sum: "$payment.weightedRevenue" },
            fraud: { $sum: { $cond: { if: { $eq: ["$payment.category", "fraud"] }, then: 1, else: 0 } } },
            firstTime: { $sum: { $cond: { if: { $eq: ["$payment.category", "first"] }, then: 1, else: 0 } } },
            purchasers: { $addToSet: "$userId" },
            sellers: { $addToSet: "$authorId" }
          }
        }
      },
      {
        $project: {
          purchases: "$purchases",
          revenue: "$revenue",
          weightedRevenue: "$weightedRevenue",
          fraud: "$fraud",
          firstTime: "$firstTime",
          purchasers: { $size: "$purchasers" },
          sellers: { $size: "$sellers" }
        }
      }
    ]).toArray();
    for (const item of results) {
      if (item._id === +midnightToday) {
        result.newPurchases.today = item.purchases;
        result.newRevenue.today = Utils.roundToDecimal(item.revenue, 2);
        result.newWeightedRevenue.today = Utils.roundToDecimal(item.weightedRevenue, 2);
        result.fraud.today = item.fraud;
        result.newFirstTime.today = item.firstTime;
        result.purchasers.today = item.purchasers;
        result.sellers.today = item.sellers;
      } else if (item._id === +yesterday) {
        result.newPurchases.yesterday = item.purchases;
        result.newRevenue.yesterday = Utils.roundToDecimal(item.revenue, 2);
        result.newWeightedRevenue.yesterday = Utils.roundToDecimal(item.weightedRevenue, 2);
        result.fraud.yesterday = item.fraud;
        result.newFirstTime.yesterday = item.firstTime;
        result.purchasers.yesterday = item.purchasers;
        result.sellers.yesterday = item.sellers;
      } else if (item._id === +previousWeek) {
        result.newPurchases.priorWeek = item.purchases;
        result.newRevenue.priorWeek = Utils.roundToDecimal(item.revenue, 2);
        result.newWeightedRevenue.priorWeek = Utils.roundToDecimal(item.weightedRevenue, 2);
        result.fraud.priorWeek = item.fraud;
        result.newFirstTime.priorWeek = item.firstTime;
        result.purchasers.priorWeek = item.purchasers;
        result.sellers.priorWeek = item.sellers;
      } else if (item._id === +previousMonth) {
        result.newPurchases.priorMonth = item.purchases;
        result.newRevenue.priorMonth = Utils.roundToDecimal(item.revenue, 2);
        result.newWeightedRevenue.priorMonth = Utils.roundToDecimal(item.weightedRevenue, 2);
        result.fraud.priorMonth = item.fraud;
        result.newFirstTime.priorMonth = item.firstTime;
        result.purchasers.priorMonth = item.purchasers;
        result.sellers.priorMonth = item.sellers;
      }
    }
    return result;
  }

  async aggregateUserCardActionPromotions(cardId: string, after: number, before: number): Promise<UserCardActionPromotionsInfo[]> {
    return this.userCardActions.aggregate([
      {
        $match: {
          cardId: cardId,
          at: {
            $gt: after,
            $lt: before
          }
        }
      },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          redeemImpressions: { $sum: "$redeemPromotion.amount" },
          redeemOpens: { $sum: "$redeemOpen.amount" },
        }
      }
    ]).toArray();
  }

  async aggregateAdStats(): Promise<AdminAdStats> {
    const info = await this.adSlots.aggregate([
      { $match: { status: { $ne: "pending" } } },
      {
        $group: {
          _id: "all",
          total: { $sum: 1 },
          revenue: { $sum: { $cond: { if: "$redeemed", then: "$amount", else: 0 } } }
        }
      }
    ]).toArray();
    const result: AdminAdStats = {
      total: info.length > 0 ? info[0].total : 0,
      revenue: info.length > 0 ? Utils.roundToDecimal(info[0].revenue, 2) : 0,
      newSlots: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newRevenue: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      consumers: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      advertisers: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
    };

    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const results = await this.adSlots.aggregate([
      { $match: { status: { $ne: "pending" } } },
      {
        $bucket: {
          groupBy: "$created",
          boundaries: buckets,
          default: -1,
          output: {
            slots: { $sum: 1 },
            revenue: { $sum: { $cond: { if: "$redeemed", then: "$amount", else: 0 } } },
            consumers: { $addToSet: "$userId" },
            advertisers: { $addToSet: "$authorId" }
          }
        }
      },
      {
        $project: {
          slots: "$slots",
          revenue: "$revenue",
          consumers: { $size: "$consumers" },
          advertisers: { $size: "$advertisers" }
        }
      }
    ]).toArray();
    for (const item of results) {
      if (item._id === +midnightToday) {
        result.newSlots.today = item.slots;
        result.newRevenue.today = Utils.roundToDecimal(item.revenue, 2);
        result.consumers.today = item.consumers;
        result.advertisers.today = item.advertisers;
      } else if (item._id === +yesterday) {
        result.newSlots.yesterday = item.slots;
        result.newRevenue.yesterday = Utils.roundToDecimal(item.revenue, 2);
        result.consumers.yesterday = item.consumers;
        result.advertisers.yesterday = item.advertisers;
      } else if (item._id === +previousWeek) {
        result.newSlots.priorWeek = item.slots;
        result.newRevenue.priorWeek = Utils.roundToDecimal(item.revenue, 2);
        result.consumers.priorWeek = item.consumers;
        result.advertisers.priorWeek = item.advertisers;
      } else if (item._id === +previousMonth) {
        result.newSlots.priorMonth = item.slots;
        result.newRevenue.priorMonth = Utils.roundToDecimal(item.revenue, 2);
        result.consumers.priorMonth = item.consumers;
        result.advertisers.priorMonth = item.advertisers;
      }
    }
    return result;
  }

  async aggregateSubscriptionStats(): Promise<AdminSubscriptionStats> {
    const info = await this.channelUsers.aggregate([
      { $match: { subscriptionState: "subscribed" } },
      {
        $group: {
          _id: "all",
          subscribers: { $addToSet: "$userId" },
          totalSubscriptions: { $sum: 1 },
          channels: { $addToSet: "$channelId" },
          bonuses: { $sum: "$bonusPaid" },
          fraud: { $sum: { $cond: { if: "$bonusFraudDetected", then: 1, else: 0 } } },
        }
      },
      { $project: { totalSubscribers: { $size: "$subscribers" }, totalSubscriptions: "$totalSubscriptions", totalChannels: { $size: "$channels" }, bonuses: "$bonuses", totalFraud: "$fraud" } }
    ]).toArray();
    const result: AdminSubscriptionStats = {
      totalSubscribers: info.length > 0 ? info[0].totalSubscribers : 0,
      totalSubscriptions: info.length > 0 ? info[0].totalSubscriptions : 0,
      totalChannelsWithSubscriptions: info.length > 0 ? info[0].totalChannels : 0,
      totalSubscriptionBonuses: info.length > 0 ? Utils.roundToDecimal(info[0].bonuses, 2) : 0,
      totalFraud: info.length > 0 ? info[0].totalFraud : 0,
      newSubscriptions: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newSubscriptionBonuses: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
      newFraud: { today: 0, yesterday: 0, priorWeek: 0, priorMonth: 0 },
    };
    const now = Date.now() + 1000 * 60;
    const midnightToday = moment().tz('America/Los_Angeles').startOf('day');
    const yesterday = moment(midnightToday).subtract(1, 'd');
    const previousWeek = moment(yesterday).subtract(7, 'd');
    const previousMonth = moment(previousWeek).subtract(30, 'd');
    const buckets: number[] = [+previousMonth, +previousWeek, +yesterday, +midnightToday, now];
    const results = await this.channelUsers.aggregate([
      { $match: { subscriptionState: "subscribed" } },
      {
        $bucket: {
          groupBy: "$lastUpdated",
          boundaries: buckets,
          default: -1,
          output: {
            subscriptions: { $sum: 1 },
            bonuses: { $sum: "$bonusPaid" },
            fraud: { $sum: { $cond: { if: "$bonusFraudDetected", then: 1, else: 0 } } },
          }
        }
      }
    ]).toArray();
    for (const item of results) {
      if (item._id === +midnightToday) {
        result.newSubscriptions.today = item.subscriptions;
        result.newSubscriptionBonuses.today = item.bonuses;
        result.newFraud.today = item.fraud;
      } else if (item._id === +yesterday) {
        result.newSubscriptions.yesterday = item.subscriptions;
        result.newSubscriptionBonuses.yesterday = item.bonuses;
        result.newFraud.yesterday = item.fraud;
      } else if (item._id === +previousWeek) {
        result.newSubscriptions.priorWeek = item.subscriptions;
        result.newSubscriptionBonuses.priorWeek = item.bonuses;
        result.newFraud.priorWeek = item.fraud;
      } else if (item._id === +previousMonth) {
        result.newSubscriptions.priorMonth = item.subscriptions;
        result.newSubscriptionBonuses.priorMonth = item.bonuses;
        result.newFraud.priorMonth = item.fraud;
      }
    }
    return result;
  }

  async insertDeposit(sessionId: string, at: number, status: DepositStatus, receivedBy: string, fromHandle: string, userId: string, amount: number, currency: string, net: number, paypalReference: string, transactionId: string): Promise<DepositRecord> {
    const record: DepositRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      at: at,
      status: status,
      receivedBy: receivedBy,
      fromHandle: fromHandle,
      userId: userId,
      amount: amount,
      currency: currency,
      net: net,
      paypalReference: paypalReference,
      transactionId: transactionId
    };
    await this.deposits.insertOne(record);
    return record;
  }

  async listDeposits(limit: number): Promise<DepositRecord[]> {
    return this.deposits.find<DepositRecord>().sort({ at: -1 }).limit(limit || 100).toArray();
  }

  async findUnprocessedDeposits(): Promise<DepositRecord[]> {
    return this.deposits.find<DepositRecord>({ status: "completed", transactionId: { $exists: false } }).toArray();
  }

  async updateDepositTransaction(depositId: string, userId: string, transactionId: string): Promise<void> {
    await this.deposits.updateOne({ id: depositId }, { $set: { userId: userId, transactionId: transactionId } });
  }

  async updateDepositComplete(depositId: string, status: DepositStatus, transactionId: string): Promise<void> {
    await this.deposits.updateOne({ id: depositId }, { $set: { status: status, transactionId: transactionId } });
  }

  async insertCardCampaign(sessionId: string, createdById: string, status: CardCampaignStatus, couponId: string, cardId: string, type: CardCampaignType, paymentAmount: number, advertiserSubsidy: number, budget: CardCampaignBudget, ends: number, geoTargets: string[]): Promise<CardCampaignRecord> {
    const stats: CardCampaignStats = {
      opens: 0,
      clicks: 0,
      impressions: 0,
      redemptions: 0,
      expenses: 0
    };
    const record: CardCampaignRecord = {
      id: uuid.v4(),
      sessionId: sessionId,
      created: Date.now(),
      createdById: createdById,
      status: status,
      eligibleAfter: 0,
      couponId: couponId,
      cardIds: [cardId],
      type: type,
      paymentAmount: paymentAmount,
      advertiserSubsidy: advertiserSubsidy,
      budget: budget,
      ends: ends,
      geoTargets: geoTargets,
      stats: stats,
      lastStatsSnapshot: 0
    };
    await this.cardCampaigns.insertOne(record);
    return record;
  }

  async findCardCampaignById(id: string): Promise<CardCampaignRecord> {
    return this.cardCampaigns.findOne<CardCampaignRecord>({ id: id });
  }

  async findCardCampaignByCardId(cardId: string): Promise<CardCampaignRecord> {
    return this.cardCampaigns.findOne<CardCampaignRecord>({ cardIds: cardId });
  }

  async countCardCampaigns(): Promise<number> {
    return this.cardCampaigns.count({});
  }

  async updateCardCampaignLastStatsSnapshot(campaignId: string, lastStatsSnapshot: number, newStatsSnapshot: number): Promise<boolean> {
    const result = await this.cardCampaigns.updateOne({ id: campaignId, lastStatsSnapshot: lastStatsSnapshot }, { $set: { lastStatsSnapshot: newStatsSnapshot } });
    return result.modifiedCount === 1;
  }

  async updateCardCampaignInfo(campaignId: string, info: CardCampaignInfo, status: CardCampaignStatus): Promise<void> {
    const update: any = { status: status };
    if (info.budget) {
      update.budget = info.budget;
    }
    if (info.ends) {
      update.ends = info.ends;
    }
    if (Array.isArray(info.geoTargets)) {
      update.geoTargets = info.geoTargets;
    }
    await this.cardCampaigns.updateOne({ id: campaignId }, { $set: update });
  }

  async findSuitableCardCampaignsRandomized(types: CardCampaignType[], geoLocation: GeoLocation, count: number, eligibleBy: number): Promise<CardCampaignRecord[]> {
    const query: any = {
      status: "active",
      eligibleAfter: { $lt: eligibleBy }
    };
    if (types.length === 1) {
      query.type = types[0];
    } else if (types.length > 1) {
      query.type = { $in: types };
    }
    if (geoLocation && geoLocation.continentCode) {
      const codes: string[] = [];
      codes.push(geoLocation.continentCode);
      if (geoLocation.countryCode) {
        codes.push(geoLocation.continentCode + "." + geoLocation.countryCode);
        if (geoLocation.regionCode) {
          codes.push(geoLocation.continentCode + "." + geoLocation.countryCode + "." + geoLocation.regionCode);
        }
        if (geoLocation.zipCode) {
          codes.push(geoLocation.continentCode + "." + geoLocation.countryCode + ":" + geoLocation.zipCode);
        }
      }
      query.$or = [
        { geoTargets: { $size: 0 } },
        { geoTargets: codes.length === 1 ? codes[0] : { $in: codes } },
      ];
    } else {
      query.geoTargets = { $size: 0 };
    }
    return this.cardCampaigns.aggregate([
      { $match: query },
      { $sample: { size: count } }
    ]).toArray();
  }

  async updateCardCampaignNextEligible(campaignId: string, eligibleAfter: number): Promise<void> {
    await this.cardCampaigns.updateOne({ id: campaignId }, { $set: { eligibleAfter: eligibleAfter } });
  }

  async updateCardCampaignStatus(campaignId: string, status: CardCampaignStatus): Promise<void> {
    await this.cardCampaigns.updateOne({ id: campaignId }, { $set: { status: status } });
  }

  async incrementCardCampaignStats(campaignId: string, increments: CardCampaignStats): Promise<void> {
    const update: any = {};
    let found = false;
    if (increments.clicks) {
      update["stats.clicks"] = increments.clicks;
      found = true;
    }
    if (increments.expenses) {
      update["stats.expenses"] = increments.expenses;
      found = true;
    }
    if (increments.impressions) {
      update["stats.impressions"] = increments.impressions;
      found = true;
    }
    if (increments.opens) {
      update["stats.opens"] = increments.opens;
      found = true;
    }
    if (increments.redemptions) {
      update["stats.redemptions"] = increments.redemptions;
      found = true;
    }
    if (found) {
      await this.cardCampaigns.updateOne({ id: campaignId }, { $inc: update });
    }
  }

  async insertCardCampaignStats(campaignId: string, at: number, stats: CardCampaignStats): Promise<CardCampaignStatsSnapshotRecord> {
    const record: CardCampaignStatsSnapshotRecord = {
      campaignId: campaignId,
      at: at,
      stats: stats
    };
    await this.cardCampaignStats.insertOne(record);
    return record;
  }

  async findCardCampaignStatsAt(campaignId: string, before: number): Promise<CardCampaignStatsSnapshotRecord> {
    const result = await this.cardCampaignStats.find<CardCampaignStatsSnapshotRecord>({ campaignId: campaignId, at: { $lt: before } }).sort({ at: -1 }).limit(1).toArray();
    return result.length > 0 ? result[0] : null;
  }

  async insertShortUrl(code: string, originalUrl: string, byId: string, sessionId: string): Promise<ShortUrlRecord> {
    const record: ShortUrlRecord = {
      at: Date.now(),
      code: code,
      originalUrl: originalUrl,
      byId: byId,
      sessionId: sessionId
    };
    await this.shortUrls.insertOne(record);
    return record;
  }

  async findShortUrlByCode(code: string): Promise<ShortUrlRecord> {
    return this.shortUrls.findOne<ShortUrlRecord>({ code: code });
  }

  async ensureAuthorUser(authorId: string, userId: string): Promise<AuthorUserRecord> {
    let record = await this.authorUsers.findOne<AuthorUserRecord>({ authorId: authorId, userId: userId, isCurrent: true });
    if (record) {
      return record;
    }
    try {
      record = {
        authorId: authorId,
        userId: userId,
        stats: {
          likes: 0,
          dislikes: 0,
          purchases: 0,
          referredCards: 0,
          referredPurchases: 0
        },
        isCurrent: true,
        periodStarting: Date.now()
      };
      await this.authorUsers.insertOne(record);
      return record;
    } catch (err) {
      return this.authorUsers.findOne<AuthorUserRecord>({ authorId: authorId, userId: userId, isCurrent: true });
    }
  }

  async incrementAuthorUserStats(request: Request, authorId: string, userId: string, likes: number, dislikes: number, purchases: number, referredCards: number, referredPurchases: number): Promise<AuthorUserRecord> {
    const now = Date.now();
    const existing = await this.ensureAuthorUser(authorId, userId);
    let updatePeriod = false;
    if (now - existing.periodStarting > MAX_AUTHOR_USER_SNAPSHOT_INTERVAL) {
      const snapshot: AuthorUserRecord = {
        authorId: authorId,
        userId: userId,
        stats: existing.stats,
        isCurrent: false,
        periodStarting: existing.periodStarting
      };
      try {
        await this.authorUsers.insertOne(snapshot);
        updatePeriod = true;
      } catch (err) {
        errorManager.warning("Db.incrementAuthorUserStats: race condition taking snapshot", request, authorId, userId);
      }
    }
    const increments: any = {
      "stats.likes": likes,
      "stats.dislikes": dislikes,
      "stats.purchases": purchases,
      "stats.referredCards": referredCards,
      "stats.referredPurchases": referredPurchases
    };
    existing.stats.likes += likes;
    existing.stats.dislikes += dislikes;
    existing.stats.purchases += purchases;
    existing.stats.referredCards += referredCards;
    existing.stats.referredPurchases += referredPurchases;
    const update: any = { $inc: increments };
    if (updatePeriod) {
      update.$set = { periodStarting: now };
    }
    await this.authorUsers.updateOne({ authorId: authorId, userId: userId, isCurrent: true }, update);
    return existing;
  }

  async findAuthorUserAt(authorId: string, userId: string, at: number): Promise<AuthorUserRecord> {
    const result = await this.authorUsers.find<AuthorUserRecord>({ authorId: authorId, userId: userId, periodStarting: { $lt: at } }).sort({ periodStarting: -1 }).limit(1).toArray();
    return result.length > 0 ? result[0] : null;
  }

  async findCurrentUserStats(userId: string): Promise<UserStatsRecord> {
    return this.userStats.findOne<UserStatsRecord>({ userId: userId, isCurrent: true });
  }
  async ensureUserStats(userId: string): Promise<UserStatsRecord> {
    let record = await this.userStats.findOne<UserStatsRecord>({ userId: userId, isCurrent: true });
    if (record) {
      return record;
    }
    try {
      record = {
        userId: userId,
        stats: {
          cardsSold: 0,
          distinctPurchasers: 0,
          cardsPurchased: 0,
          distinctVendors: 0,
          cardsReferred: 0,
          vendorsReferred: 0,
          purchasesReferred: 0,
          cardsLiked: 0,
        },
        isCurrent: true,
        periodStarting: Date.now()
      };
      await this.userStats.insertOne(record);
      return record;
    } catch (err) {
      return this.userStats.findOne<UserStatsRecord>({ userId: userId, isCurrent: true });
    }
  }

  async incrementUserStats(request: Request, userId: string, cardsSold: number, distinctPurchasers: number, cardsPurchased: number, distinctVendors: number, cardsReferred: number, vendorsReferred: number, purchasesReferred: number, cardsLiked: number): Promise<void> {
    const now = Date.now();
    const existing = await this.ensureUserStats(userId);
    let updatePeriod = false;
    if (now - existing.periodStarting > MAX_USER_STATS_SNAPSHOT_INTERVAL) {
      const snapshot: UserStatsRecord = {
        userId: userId,
        stats: existing.stats,
        isCurrent: false,
        periodStarting: existing.periodStarting
      };
      try {
        await this.userStats.insertOne(snapshot);
        updatePeriod = true;
      } catch (err) {
        errorManager.warning("Db.incrementUserStats: race condition taking snapshot", request, userId);
      }
    }
    const increments: any = {
      "stats.cardsSold": cardsSold,
      "stats.distinctPurchasers": distinctPurchasers,
      "stats.cardsPurchased": cardsPurchased,
      "stats.distinctVendors": distinctVendors,
      "stats.cardsReferred": cardsReferred,
      "stats.vendorsReferred": vendorsReferred,
      "stats.purchasesReferred": purchasesReferred,
      "stats.cardsLiked": cardsLiked,
    };
    const update: any = { $inc: increments };
    if (updatePeriod) {
      update.$set = { periodStarting: now };
    }
    await this.userStats.updateOne({ userId: userId, isCurrent: true }, update);
  }

  async findUserStatsAt(userId: string, at: number): Promise<UserStatsRecord> {
    const result = await this.userStats.find<UserStatsRecord>({ userId: userId, periodStarting: { $lt: at } }).sort({ periodStarting: -1 }).limit(1).toArray();
    return result.length > 0 ? result[0] : null;
  }

}

// [0, 1518195600000, 1518282000000, 1518368400000, 1518454800000, 1518809800000]

const db = new Database();

export { db };

export interface BinnedUserData {
  _id: number;
  newUsers: number;
  newUsersWithIdentity: number;
  totalExcessBalance: number;
  totalExcessBalanceWithIdentity: number;
  returning: number;
  returningWithIdentity: number;
  publishers: number;
}

export interface BinnedCardData {
  _id: number;
  total: number;
  deleted: number;
  private: number;
  blocked: number;
  ads: number;
  promoted: number;
  budget: number;
  spent: number;
  revenue: number;
  refunds: number;
}

export interface BinnedPaymentData {
  _id: number;
  total: number;
  firstTime: number;
  normal: number;
  fan: number;
  fraud: number;
  revenue: number;
  weightedRevenue: number;
  purchasers: number;
  sellers: number;
}

export interface BinnedAdSlotData {
  _id: number;
  total: number;
  impressionAd: number;
  impressionContent: number;
  openPayment: number;
  clickPayment: number;
  announcement: number;
  impression: number;
  opened: number;
  openPaid: number;
  clicked: number;
  redemptionFailed: number;
  impressionsRevenue: number;
  opensRevenue: number;
  clicksRevenue: number;
  consumers: number;
  advertisers: number;
}

interface CardTopicDescriptor {
  topic: string;
  keywords: string[];
}

const DEFAULT_CARD_TOPICS = [
  { topic: "Writing", keywords: ["writing", "poetry", "blog", "essay", "prose", "blog", "short story", "story", "novel", "memo", "fiction", "non-fiction"] },
  { topic: "Photography", keywords: ["photography", "photo", "photo-essay", "picture", "pictures"] },
  { topic: "Film", keywords: ["film", "video", "time-lapsed", "animation"] },
  { topic: "Opinion", keywords: ["opinion"] },
  { topic: "Food", keywords: ["food", "cook", "cooking", "recipe", "kitchen"] },
  { topic: "Fashion", keywords: ["fashion", "makeup", "clothes", "clothing", "beauty", "hair"] },
  { topic: "Travel", keywords: ["travel"] },
  { topic: "Music", keywords: ["music", "song", "band"] },
  { topic: "Politics", keywords: ["politics"] },
  { topic: "Channels", keywords: ["channels"] },
  { topic: "Sports", keywords: ["sports", "yoga", "climbing", "football", "baseball", "basketball"] },
  { topic: "Art", keywords: ["art", "painting", "drawing", "literature", "sculpture"] },
  { topic: "Crafts", keywords: ["crafts", "woodworking", "sewing", "batik"] },
  { topic: "Games", keywords: ["games", "game"] },
  { topic: "Interactive", keywords: ["interactive"] },
  { topic: "How To", keywords: ["how to", "howto"] },
  { topic: "Money", keywords: ["money", "currency", "cryptocurrency"] },
  { topic: "Technology", keywords: ["technology", "computers", "computer", "internet", "web"] }
];

export interface ChannelStatInfo {
  revenue: number;
  cards: number;
}

export interface AggregatedUserActionPaymentInfo {
  _id: string;
  purchases: number;
  grossRevenue: number;
  weightedRevenue: number;
}

export interface AggregatedCardPaymentInfo {
  _id: string;
  firstTimePurchases: number;
  normalPurchases: number;
  fraudPurchases: number;
}

export interface UserCardActionPromotionsInfo {
  _id: CardActionType;
  count: number;
  redeemImpressions: number;
  redeemOpens: number;
}

export interface RedemptionInfo {
  count: number;
  total: number;
}
