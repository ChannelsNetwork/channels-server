import { MongoClient, Db, Collection, Cursor, MongoClientOptions } from "mongodb";
import * as uuid from "uuid";

import { configuration } from "./configuration";
import { UserRecord, NetworkRecord, UserIdentity, CardRecord, FileRecord, FileStatus, CardMutationRecord, CardStateGroup, CardMutationType, CardPropertyRecord, CardCollectionItemRecord, Mutation, MutationIndexRecord, NewsItemRecord, DeviceTokenRecord, DeviceType, SubsidyBalanceRecord, CardOpensRecord, CardOpensInfo, BowerManagementRecord, BankTransactionRecord, UserAccountType, CardActionType, UserCardActionRecord, UserCardInfoRecord, CardLikeState, BankTransactionReason, BankCouponRecord, BankCouponDetails, CardActiveState, ManualWithdrawalState, ManualWithdrawalRecord, CardStatisticHistoryRecord, CardStatistic, CardCollectionRecord, CardPromotionScores, CardPromotionBin, BankDepositStatus, BankDepositRecord, UserAddressHistory, OldUserRecord, BowerPackageRecord, CardType } from "./interfaces/db-records";
import { Utils } from "./utils";
import { BankTransactionDetails, BraintreeTransactionResult, BowerInstallResult, ChannelComponentDescriptor } from "./interfaces/rest-services";
import { SignedObject } from "./interfaces/signed-object";
import { SERVER_VERSION } from "./server-version";

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
  private files: Collection;
  private newsItems: Collection;
  private deviceTokens: Collection;
  private cardOpens: Collection;
  private subsidyBalance: Collection;
  private bowerManagement: Collection;
  private bankTransactions: Collection;
  private userCardActions: Collection;
  private userCardInfo: Collection;
  private bankCoupons: Collection;
  private manualWithdrawals: Collection;
  private cardStatsHistory: Collection;
  private bankDeposits: Collection;
  private bowerPackages: Collection;

  async initialize(): Promise<void> {
    const configOptions = configuration.get('mongo.options') as MongoClientOptions;
    const options: MongoClientOptions = configOptions ? configOptions : { w: 1 };
    this.db = await MongoClient.connect(configuration.get('mongo.mongoUrl', options));
    await this.initializeNetworks();
    await this.initializeOldUsers();
    await this.initializeUsers();
    await this.initializeCards();
    await this.initializeMutationIndexes();
    await this.initializeMutations();
    await this.initializeCardProperties();
    await this.initializeCardCollections();
    await this.initializeCardCollectionItems();
    await this.initializeFiles();
    await this.initializeNewsItems();
    await this.initializeDeviceTokens();
    await this.initializeCardOpens();
    await this.initializeSubsidyBalance();
    await this.initializeBowerManagement();
    await this.initializeBankTransactions();
    await this.initializeUserCardActions();
    await this.initializeUserCardInfo();
    await this.initializeBankCoupons();
    await this.initializeManualWithdrawals();
    await this.initializeCardStatsHistory();
    await this.initializeBankDeposits();
    await this.initializeBowerPackages();
  }

  private async initializeNetworks(): Promise<void> {
    this.networks = this.db.collection('networks');
    await this.networks.createIndex({ id: 1 }, { unique: true });
    const existing = await this.networks.findOne<NetworkRecord>({ id: "1" });
    if (existing) {
      await this.networks.updateMany({ totalPublisherRevenue: { $exists: false } }, {
        $set: {
          totalPublisherRevenue: 0,
          totalCardDeveloperRevenue: 0,
          totalDeposits: 0,
          totalWithdrawals: 0
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
        totalWithdrawals: 0
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
    const noIds = await this.users.find<UserRecord>({ id: { $exists: false } }).toArray();
    for (const u of noIds) {
      await this.users.updateOne({ inviterCode: u.inviterCode }, { $set: { id: uuid.v4() } });
    }

    await this.users.createIndex({ id: 1 }, { unique: true });
    await this.users.createIndex({ address: 1 }, { unique: true });
    await this.users.createIndex({ inviterCode: 1 }, { unique: true });
    await this.users.createIndex({ "identity.handle": 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ "identity.emailAddress": 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ type: 1, balanceLastUpdated: -1 });
    await this.users.createIndex({ type: 1, lastContact: -1 });
    await this.users.createIndex({ type: 1, balanceBelowTarget: 1 });
    await this.users.createIndex({ recoveryCode: 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ ipAddresses: 1, added: -1 });

    await this.users.updateMany({ type: { $exists: false } }, { $set: { type: "normal" } });
    await this.users.updateMany({ lastContact: { $exists: false } }, { $set: { lastContact: 0 } });
    await this.users.updateMany({ balanceBelowTarget: { $exists: false } }, { $set: { balanceBelowTarget: false } });
    await this.users.updateMany({ targetBalance: { $exists: false } }, { $set: { targetBalance: 0 } });
    await this.users.updateMany({ withdrawableBalance: { $exists: false } }, { $set: { withdrawableBalance: 0 } });
    await this.users.updateMany({ balanceLastUpdated: { $exists: false } }, { $set: { balanceLastUpdated: Date.now() - 60 * 60 * 1000 } });

    const noTarget = await this.users.find<UserRecord>({ type: "normal", targetBalance: 0 }).toArray();
    for (const u of noTarget) {
      await this.users.updateOne({ id: u.id }, { $set: { targetBalance: u.balance, balanceBelowTarget: false } });
    }

    const noHistory = await this.users.find<UserRecord>({ addressHistory: { $exists: false } }).toArray();
    for (const u of noHistory) {
      await this.users.updateOne({ id: u.id }, { $push: { addressHistory: { address: u.address, publicKey: u.publicKey, added: Date.now() } } });
    }

    await this.users.createIndex({ "addressHistory.address": 1 }, { unique: true });

    await this.users.updateMany({ ipAddresses: { $exists: false } }, { $set: { ipAddresses: [] } });
  }

  private async initializeCards(): Promise<void> {
    this.cards = this.db.collection('cards');
    await this.cards.createIndex({ id: 1 }, { unique: true });
    await this.cards.createIndex({ state: 1, postedAt: 1, lastScored: -1 });
    await this.cards.createIndex({ state: 1, "budget.available": 1, private: 1, postedAt: -1 });
    await this.cards.createIndex({ state: 1, "by.id": 1, postedAt: -1 });
    await this.cards.createIndex({ state: 1, "by.id": 1, "stats.revenue.value": -1 });
    await this.cards.createIndex({ state: 1, "by.id": 1, "pricing.openFeeUnits": 1, score: -1 });

    await this.cards.updateMany({ promotionScores: { $exists: false } }, { $set: { promotionScores: { a: 0, b: 0, c: 0, d: 0, e: 0 } } });
    await this.cards.createIndex({ state: 1, private: 1, "promotionScores.a": -1 });
    await this.cards.createIndex({ state: 1, private: 1, "promotionScores.b": -1 });
    await this.cards.createIndex({ state: 1, private: 1, "promotionScores.c": -1 });
    await this.cards.createIndex({ state: 1, private: 1, "promotionScores.d": -1 });
    await this.cards.createIndex({ state: 1, private: 1, "promotionScores.e": -1 });

    await this.cards.updateMany({ curation: { $exists: false } }, { $set: { curation: { block: false } } });
    await this.cards.updateMany({ type: { $exists: false } }, { $set: { type: "normal" } });
    await this.cards.createIndex({ type: 1, postedAt: -1 });

    // Migration: from single coupon per card to multiple  coupon > coupons, couponId > couponIds
    await this.cards.updateMany({ coupons: { $exists: false } }, { $set: { coupons: [] } });
    await this.cards.updateMany({ couponIds: { $exists: false } }, { $set: { couponIds: [] } });

    let cards = await this.cards.find<CardRecord>({ coupon: { $exists: true } }).toArray();
    for (const card of cards) {
      await this.cards.updateOne({ id: card.id }, { $push: { coupons: card.coupon, couponIds: card.couponId }, $unset: { coupon: 1, couponId: 1 } });
    }

    if (SERVER_VERSION <= 100) {
      console.log("Db.initializeCards: Stripping version portion from card type on existing cards");
      cards = await this.cards.find<CardRecord>({}).toArray();
      for (const card of cards) {
        if (card.cardType && card.cardType.package && card.cardType.package.indexOf('#') > 0) {
          const packageName = card.cardType.package.split('#')[0];
          await this.cards.updateOne({ id: card.id }, { $set: { "cardType.package": packageName } });
        }
      }
    }
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

  private async initializeFiles(): Promise<void> {
    this.files = this.db.collection('files');
    await this.files.createIndex({ id: 1 }, { unique: true });
  }

  private async initializeNewsItems(): Promise<void> {
    this.newsItems = this.db.collection('newsItems');
    await this.newsItems.createIndex({ id: 1 }, { unique: true });
    await this.newsItems.createIndex({ timestamp: -1 });
  }
  private async initializeDeviceTokens(): Promise<void> {
    this.deviceTokens = this.db.collection('deviceTokens');
    await this.deviceTokens.createIndex({ type: 1, token: 1 }, { unique: true });
    await this.deviceTokens.createIndex({ userAddress: 1, type: 1 });
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
        console.error("Db.initializeSubsidyBalance: collision adding initial record");
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
  }

  private async initializeUserCardActions(): Promise<void> {
    this.userCardActions = this.db.collection('userCardActions');
    await this.userCardActions.createIndex({ id: 1 }, { unique: true });
    await this.userCardActions.createIndex({ userId: 1, action: 1, at: -1 });
  }

  private async initializeUserCardInfo(): Promise<void> {
    this.userCardInfo = this.db.collection('userCardInfo');
    await this.userCardInfo.createIndex({ userId: 1, cardId: 1 }, { unique: true });
    await this.userCardInfo.createIndex({ userId: 1, lastOpened: -1 });
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

  private async initializeBankDeposits(): Promise<void> {
    this.bankDeposits = this.db.collection('bankDeposits');
    await this.bankDeposits.createIndex({ id: 1 }, { unique: true });
    await this.bankDeposits.createIndex({ status: 1, at: -1 });
  }

  private async initializeBowerPackages(): Promise<void> {
    this.bowerPackages = this.db.collection('bowerPackages');
    await this.bowerPackages.createIndex({ packageName: 1 }, { unique: true });
  }

  async getNetwork(): Promise<NetworkRecord> {
    return await this.networks.findOne({ id: '1' });
  }

  async incrementNetworkTotals(incrPublisherRev: number, incrCardDeveloperRev: number, incrDeposits: number, incrWithdrawals: number): Promise<void> {
    const update: any = {};
    if (incrPublisherRev) {
      update.totalPublisherRevenue = incrPublisherRev;
    }
    if (incrCardDeveloperRev) {
      update.totalCardDeveloperRevenue = incrCardDeveloperRev;
    }
    if (incrDeposits) {
      update.totalDeposits = incrDeposits;
    }
    if (incrWithdrawals) {
      update.totalWithdrawals = incrWithdrawals;
    }
    await this.networks.updateOne({ id: "1" }, { $inc: update });
  }

  async getOldUsers(): Promise<OldUserRecord[]> {
    return await this.oldUsers.find().toArray();
  }

  async insertUser(type: UserAccountType, address: string, publicKey: string, encryptedPrivateKey: string, inviteeCode: string, inviterCode: string, invitationsRemaining: number, invitationsAccepted: number, targetBalance: number, minBalanceAfterWithdrawal: number, ipAddress: string, id?: string, identity?: UserIdentity): Promise<UserRecord> {
    const now = Date.now();
    const record: UserRecord = {
      id: id ? id : uuid.v4(),
      type: type,
      address: address,
      publicKey: publicKey,
      addressHistory: [
        { address: address, publicKey: publicKey, added: now }
      ],
      encryptedPrivateKey: encryptedPrivateKey,
      added: now,
      inviteeCode: inviteeCode,
      inviterCode: inviterCode,
      balanceLastUpdated: now,
      balance: 0,
      targetBalance: targetBalance,
      balanceBelowTarget: false,
      minBalanceAfterWithdrawal: minBalanceAfterWithdrawal,
      invitationsRemaining: invitationsRemaining,
      invitationsAccepted: invitationsAccepted,
      lastContact: now,
      storage: 0,
      admin: false,
      ipAddresses: []
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
    await this.users.insert(record);
    return record;
  }

  async updateUserBalance(userId: string, value: number): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { balance: value } });
  }

  async updateUserRecoveryCode(user: UserRecord, code: string, expires: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { recoveryCode: code, recoveryCodeExpires: expires } });
    user.recoveryCode = code;
    user.recoveryCodeExpires = expires;
  }

  async clearRecoveryCode(user: UserRecord): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $unset: { recoveryCode: 1, recoveryCodeExpires: 1 } });
    delete user.recoveryCode;
    delete user.recoveryCodeExpires;
  }

  async findUserById(id: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ id: id });
  }

  async findUserByAddress(address: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ address: address });
  }

  async findUserByHistoricalAddress(address: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "addressHistory.address": address });
  }

  async findUserByRecoveryCode(code: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ recoveryCode: code });
  }

  async findUserByInviterCode(code: string): Promise<UserRecord> {
    if (!code) {
      return null;
    }
    return await this.users.findOne<UserRecord>({ inviterCode: code.toLowerCase() });
  }

  async findUsersByType(type: UserAccountType): Promise<UserRecord[]> {
    return await this.users.find<UserRecord>({ type: type }).toArray();
  }

  async findNetworkUser(): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ type: "network" });
  }

  async findNetworkDeveloperUser(): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ type: "networkDeveloper" });
  }

  async findUserByHandle(handle: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "identity.handle": handle.toLowerCase() });
  }

  async findUserByEmail(emailAddress: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "identity.emailAddress": emailAddress.toLowerCase() });
  }

  async findUsersByIpAddress(ipAddress: string, limit = 25): Promise<UserRecord[]> {
    return await this.users.find<UserRecord>({ ipAddresses: ipAddress }).sort({ added: -1 }).limit(limit).toArray();
  }

  async updateLastUserContact(userRecord: UserRecord, lastContact: number): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $set: { lastContact: lastContact } });
    userRecord.lastContact = lastContact;
  }

  async deleteUser(id: string): Promise<void> {
    await this.users.deleteOne({ id: id });
  }

  async updateUserIdentity(userRecord: UserRecord, name: string, handle: string, imageUrl: string, location: string, emailAddress: string, encryptedPrivateKey: string): Promise<void> {
    const update: any = {};
    if (!userRecord.identity) {
      userRecord.identity = {
        name: null,
        handle: null,
        imageUrl: null,
        location: null,
        emailAddress: null
      };
    }
    if (name) {
      update["identity.name"] = name;
      userRecord.identity.name = name;
    }
    if (handle) {
      update["identity.handle"] = handle.toLowerCase();
      userRecord.identity.handle = handle.toLowerCase();
    }
    if (imageUrl) {
      update["identity.imageUrl"] = imageUrl;
      userRecord.identity.imageUrl = imageUrl;
    }
    if (location) {
      update["identity.location"] = location;
      userRecord.identity.location = location;
    }
    if (emailAddress) {
      update["identity.emailAddress"] = emailAddress.toLowerCase();
      userRecord.identity.emailAddress = emailAddress.toLowerCase();
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

  async incrementInvitationsAccepted(user: UserRecord, reward: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, {
      $inc: {
        invitationsRemaining: -1,
        invitationsAccepted: 1
      }
    });
    user.invitationsRemaining--;
    user.invitationsAccepted++;
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
    return await this.users.find<UserRecord>({ type: "normal", balanceLastUpdated: { $lt: before } }).toArray();
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

  async addUserIpAddress(userRecord: UserRecord, ipAddress: string): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $push: { ipAddresses: ipAddress } });
    userRecord.ipAddresses.push(ipAddress);
  }

  async discardUserIpAddress(userRecord: UserRecord, ipAddress: string): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $pull: { ipAddresses: ipAddress } });
    userRecord.ipAddresses.splice(userRecord.ipAddresses.indexOf(ipAddress), 1);
  }

  async countUsersbalanceBelowTarget(): Promise<number> {
    return await this.users.count({ type: "normal", balanceBelowTarget: true });
  }

  async insertCard(byUserId: string, byAddress: string, byHandle: string, byName: string, byImageUrl: string, cardImageUrl: string, cardImageWidth: number, cardImageHeight: number, linkUrl: string, title: string, text: string, isPrivate: boolean, cardType: string, cardTypeIconUrl: string, cardTypeRoyaltyAddress: string, cardTypeRoyaltyFraction: number, promotionFee: number, openPayment: number, openFeeUnits: number, budgetAmount: number, budgetAvailable: boolean, budgetPlusPercent: number, coupon: SignedObject, couponId: string, promotionScores?: CardPromotionScores, id?: string, now?: number): Promise<CardRecord> {
    if (!now) {
      now = Date.now();
    }
    const record: CardRecord = {
      id: id ? id : uuid.v4(),
      state: "active",
      postedAt: now,
      by: {
        id: byUserId,
        address: byAddress,
        handle: byHandle,
        name: byName,
        imageUrl: byImageUrl
      },
      summary: {
        imageUrl: cardImageUrl,
        imageWidth: cardImageWidth,
        imageHeight: cardImageHeight,
        linkUrl: linkUrl,
        title: title,
        text: text,
      },
      private: isPrivate,
      cardType: {
        package: cardType,
        iconUrl: cardTypeIconUrl,
        royaltyAddress: cardTypeRoyaltyAddress,
        royaltyFraction: cardTypeRoyaltyFraction
      },
      pricing: {
        promotionFee: promotionFee,
        openPayment: openPayment,
        openFeeUnits: openFeeUnits
      },
      budget: {
        amount: budgetAmount,
        plusPercent: budgetPlusPercent,
        spent: 0,
        available: budgetAvailable
      },
      coupons: [],
      couponIds: [],
      stats: {
        revenue: { value: 0, lastSnapshot: 0 },
        promotionsPaid: { value: 0, lastSnapshot: 0 },
        openFeesPaid: { value: 0, lastSnapshot: 0 },
        impressions: { value: 0, lastSnapshot: 0 },
        uniqueImpressions: { value: 0, lastSnapshot: 0 },
        opens: { value: 0, lastSnapshot: 0 },
        uniqueOpens: { value: 0, lastSnapshot: 0 },
        likes: { value: 0, lastSnapshot: 0 },
        dislikes: { value: 0, lastSnapshot: 0 }
      },
      score: 0,
      promotionScores: { a: 0, b: 0, c: 0, d: 0, e: 0 },
      lastScored: 0,
      lock: {
        server: '',
        at: 0
      },
      curation: {
        block: false
      },
      type: "normal"
    };
    if (coupon) {
      record.coupons.push(coupon);
      record.couponIds.push(couponId);
    }
    if (promotionScores) {
      record.promotionScores = promotionScores;
    }
    await this.cards.insert(record);
    return record;
  }

  async countCards(): Promise<number> {
    return await this.cards.count({});
  }

  async lockCard(cardId: string, timeout: number, serverId: string): Promise<CardRecord> {
    const count = 0;
    while (count < 300) {
      const card = await this.cards.findOne({ id: cardId });
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

  async findCardById(id: string, includeInactive: boolean): Promise<CardRecord> {
    if (!id) {
      return null;
    }
    const query: any = { id: id };
    if (!includeInactive) {
      query.state = "active";
    }
    return await this.cards.findOne<CardRecord>(query);
  }

  async findCardMostRecentByType(type: CardType): Promise<CardRecord> {
    const result = await this.cards.find<CardRecord>({ type: type }).sort({ postedAt: -1 }).limit(1).toArray();
    if (result.length > 0) {
      return result[0];
    } else {
      return null;
    }
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

  async updateCardBudgetUsage(card: CardRecord, incSpent: number, available: boolean, promotionScores: CardPromotionScores): Promise<void> {
    await this.cards.updateOne({ id: card.id }, {
      $inc: {
        "budget.spent": incSpent
      },
      $set: {
        "budget.available": available,
        promotionScores: promotionScores
      }
    });
    card.budget.spent += incSpent;
    card.budget.available = available;
    card.promotionScores = promotionScores;
  }

  async updateCardBudgetAvailable(card: CardRecord, available: boolean, promotionScores: CardPromotionScores): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { "budget.available": available, promotionScores: promotionScores } });
    card.budget.available = available;
    card.promotionScores = promotionScores;
  }

  async updateCardPromotionScores(card: CardRecord, promotionScores: CardPromotionScores): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { promotionScores: promotionScores } });
    card.promotionScores = promotionScores;
  }

  async updateCardSummary(card: CardRecord, title: string, text: string, linkUrl: string, imageUrl: string, imageWidth: number, imageHeight: number): Promise<void> {
    const update: any = {
      summary: {
        title: title,
        text: text,
        linkUrl: linkUrl,
        imageUrl: imageUrl,
        imageWidth: imageWidth,
        imageHeight: imageHeight
      }
    };
    await this.cards.updateOne({ id: card.id }, { $set: update });
  }

  async addCardStat(card: CardRecord, statName: string, value: number): Promise<void> {
    const update: any = {};
    update["stats." + statName] = { value: value, lastSnapshot: 0 };
    await this.cards.updateOne({ id: card.id }, { $set: update });
    (card.stats as any)[statName] = { value: value, lastSnapshot: 0 };
  }

  async updateCardPricing(card: CardRecord, promotionFee: number, openPayment: number, openFeeUnits: number, couponId: string, coupon: SignedObject, budgetAmount: number, plusPercent: number, budgetAvailable: boolean): Promise<void> {
    const update: any = {
      $set: {
        pricing: {
          promotionFee: promotionFee,
          openPayment: openPayment,
          openFeeUnits: openFeeUnits
        },
        "budget.amount": budgetAmount,
        "budget.plusPercent": plusPercent,
        "budget.available": budgetAvailable
      }
    };
    if (couponId) {
      update.$push = {
        coupons: coupon,
        couponIds: couponId
      };
    }
    await this.cards.updateOne({ id: card.id }, update);
  }

  async incrementCardStat(card: CardRecord, statName: string, incrementBy: number, lastSnapshot?: number, promotionScores?: CardPromotionScores): Promise<void> {
    const incClause: any = {};
    incClause["stats." + statName + ".value"] = incrementBy;
    const update: any = { $inc: incClause };
    if (lastSnapshot) {
      const snapClause: any = {};
      snapClause["stats." + statName + ".lastSnapshot"] = lastSnapshot;
      update.$set = snapClause;
    }
    if (promotionScores) {
      if (!update.$set) {
        update.$set = {};
      }
      update.$set.promotionScores = promotionScores;
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
    if (promotionScores) {
      card.promotionScores = promotionScores;
    }
  }

  async updateCardPrivate(card: CardRecord, isPrivate: boolean): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { private: isPrivate } });
    card.private = isPrivate;
  }

  async updateCardState(card: CardRecord, state: CardActiveState): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $set: { state: state } });
    card.state = state;
  }

  async findCardsForScoring(postedAfter: number, scoredBefore: number): Promise<CardRecord[]> {
    return await this.cards.find<CardRecord>({ state: "active", postedAt: { $gt: postedAfter }, lastScored: { $lt: scoredBefore } }).toArray();
  }

  async findCardsWithAvailableBudget(limit: number): Promise<CardRecord[]> {
    return await this.cards.find<CardRecord>({ state: "active", "budget.available": true, private: false }).sort({ postedAt: -1 }).limit(limit).toArray();
  }

  async findCardsByUserAndTime(before: number, after: number, maxCount: number, byUserId: string, excludePrivate: boolean): Promise<CardRecord[]> {
    const query: any = { state: "active" };
    if (excludePrivate) {
      query.private = false;
      query["curation.block"] = false;
    }
    query["by.id"] = byUserId;
    if (before && after) {
      query.postedAt = { $lt: before, $gt: after };
    } else if (before) {
      query.postedAt = { $lt: before };
    } else if (after) {
      query.postedAt = { $gt: after };
    }
    return this.cards.find(query).sort({ postedAt: -1 }).limit(maxCount).toArray();
  }

  async findAccessibleCardsByTime(before: number, after: number, maxCount: number, userId: string): Promise<CardRecord[]> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    if (before && after) {
      query.postedAt = { $lt: before, $gt: after };
    } else if (before) {
      query.postedAt = { $lt: before };
    } else if (after) {
      query.postedAt = { $gt: after };
    }
    return this.cards.find(query).sort({ postedAt: -1 }).limit(maxCount).toArray();
  }

  async findCardsByRevenue(maxCount: number, userId: string, lessThan = 0): Promise<CardRecord[]> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    query["stats.revenue.value"] = lessThan > 0 ? { $lt: lessThan, $gt: 0 } : { $gt: 0 };
    return this.cards.find(query).sort({ "stats.revenue.value": -1 }).limit(maxCount).toArray();
  }

  private addAuthorClause(query: any, userId: string): void {
    query.$or = [
      { "by.id": userId },
      {
        $and: [
          { private: false },
          { "curation.block": false }
        ]
      }
    ];
  }

  async findCardsByScore(limit: number, userId: string, ads: boolean, scoreLessThan = 0): Promise<CardRecord[]> {
    const query: any = { state: "active" };
    this.addAuthorClause(query, userId);
    query["pricing.openFeeUnits"] = ads ? { $lte: 0 } : { $gt: 0 };
    if (scoreLessThan) {
      query.score = { $lt: scoreLessThan };
    }
    return await this.cards.find(query).sort({ score: -1 }).limit(limit).toArray();
  }

  findCardsByPromotionScore(bin: CardPromotionBin): Cursor<CardRecord> {
    const sort: any = {};
    sort["promotionScores." + bin] = -1;
    return this.cards.find<CardRecord>({ state: "active", private: false, "curation.block": false }).sort(sort);
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
      console.warn("Db.ensureMutationIndex: race condition");
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
    return await this.mutations.findOne<CardMutationRecord>({ mutationId: mutationId });
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
    return await db.mutations.find<CardMutationRecord>({ index: { $gt: index } }).sort({ index: 1 }).toArray();
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
    return await this.cardProperties.find<CardPropertyRecord>({ cardId: cardId, group: group, user: user }).sort({ name: 1 }).toArray();
  }

  async findCardProperty(cardId: string, group: CardStateGroup, user: string, name: string): Promise<CardPropertyRecord> {
    return await this.cardProperties.findOne<CardPropertyRecord>({ cardId: cardId, group: group, user: user, name: name });
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
    return await this.cardCollections.find<CardCollectionRecord>({ cardId: cardId, group: group, user: user }).toArray();
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
    return await this.cardCollectionItems.findOne({ cardId: cardId, group: group, user: user, collectionName: collectionName, key: key });
  }

  async findCardCollectionItems(cardId: string, group: CardStateGroup, user: string, collectionName: string): Promise<CardCollectionItemRecord[]> {
    return await this.cardCollectionItems.find<CardCollectionItemRecord>({ cardId: cardId, group: group, user: user, collectionName: collectionName }).sort({ index: 1 }).toArray();
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
      url: null
    };
    await this.files.insert(record);
    return record;
  }

  async updateFileStatus(fileRecord: FileRecord, status: FileStatus): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, { $set: { status: status } });
    fileRecord.status = status;
  }

  async updateFileProgress(fileRecord: FileRecord, ownerId: string, filename: string, encoding: string, mimetype: string, s3Key: string, status: FileStatus): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: {
        ownerId: ownerId,
        filename: filename,
        encoding: encoding,
        mimetype: mimetype,
        "s3.key": s3Key,
        status: status
      }
    });
    fileRecord.ownerId = ownerId;
    fileRecord.filename = filename;
    fileRecord.encoding = encoding;
    fileRecord.mimetype = mimetype;
    fileRecord.s3.key = s3Key;
    fileRecord.status = status;
  }

  async updateFileCompletion(fileRecord: FileRecord, status: FileStatus, size: number, url: string): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: {
        status: status,
        size: size,
        url: url
      }
    });
    fileRecord.status = status;
    fileRecord.size = size;
  }

  async findFileById(id: string): Promise<FileRecord> {
    if (!id) {
      return null;
    }
    return await this.files.findOne<FileRecord>({ id: id });
  }

  async insertNewsItem(record: NewsItemRecord): Promise<NewsItemRecord> {
    try {
      await this.newsItems.insertOne(record);
    } catch (err) {
      console.log("Initial news item is already present");
      // noop:  record may already be there
    }
    return await this.newsItems.findOne<NewsItemRecord>({ id: record.id });
  }

  async findNewsItemById(id: string): Promise<NewsItemRecord> {
    return await this.newsItems.findOne<NewsItemRecord>({ id: id });
  }

  async findNewsItems(maxCount: number): Promise<NewsItemRecord[]> {
    if (!maxCount || maxCount < 0 || maxCount > 200) {
      maxCount = 200;
    }
    return await this.newsItems.find<NewsItemRecord>().sort({ timestamp: -1 }).limit(maxCount).toArray();
  }

  async insertDeviceToken(type: DeviceType, token: string, userAddress: string): Promise<DeviceTokenRecord> {
    const record: DeviceTokenRecord = {
      type: type,
      token: token,
      userAddress: userAddress,
      added: Date.now()
    };
    await this.deviceTokens.insertOne(record);
    return record;
  }

  async findDeviceToken(type: DeviceType, token: string): Promise<DeviceTokenRecord> {
    return await this.deviceTokens.findOne<DeviceTokenRecord>({ type: type, token: token });
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
    return await this.subsidyBalance.findOne<SubsidyBalanceRecord>({ id: "1" });
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
    return await this.bowerManagement.findOne<BowerManagementRecord>({ id: id });
  }

  async insertBankTransaction(at: number, originatorUserId: string, participantUserIds: string[], relatedCardTitle: string, details: BankTransactionDetails, recipientUserIds: string[], signedObject: SignedObject, deductions: number, remainderShares: number, withdrawalType: string): Promise<BankTransactionRecord> {
    const record: BankTransactionRecord = {
      id: uuid.v4(),
      at: at,
      originatorUserId: originatorUserId,
      participantUserIds: participantUserIds,
      relatedCardTitle: relatedCardTitle,
      details: details,
      recipientUserIds: recipientUserIds,
      signedObject: signedObject,
      deductions: deductions,
      remainderShares: remainderShares
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
    return await db.bankTransactions.findOne<BankTransactionRecord>({ id: id });
  }

  async findBankTransactionsByParticipant(participantUserId: string, omitInterest: boolean, limit = 500): Promise<BankTransactionRecord[]> {
    const query: any = {
      participantUserIds: participantUserId
    };
    if (omitInterest) {
      query["details.reason"] = { $nin: ["interest", "subsidy"] };
    }
    return await db.bankTransactions.find<BankTransactionRecord>(query).sort({ "details.timestamp": -1 }).limit(limit).toArray();
  }

  async countBankTransactions(): Promise<number> {
    return await db.bankTransactions.count({});
  }

  async updateBankTransactionWithdrawalStatus(transactionId: string, referenceId: string, status: string, err: any): Promise<void> {
    await db.bankTransactions.updateOne({ id: transactionId }, {
      $set: {
        "withdrawalInfo.referenceId": referenceId,
        "withdrawalInfo.status": status,
        "withdrawalInfo.err": err
      }
    });
  }

  async insertUserCardAction(userId: string, cardId: string, at: number, action: CardActionType, payment: number, paymentTransactionId: string, redeemPromotion: number, redeemPromotionTransactionId: string, redeemOpen: number, redeemOpenTransactionId: string): Promise<UserCardActionRecord> {
    const record: UserCardActionRecord = {
      id: uuid.v4(),
      userId: userId,
      cardId: cardId,
      at: at,
      action: action
    };
    if (payment || paymentTransactionId) {
      record.payment = {
        amount: payment,
        transactionId: paymentTransactionId
      };
    }
    if (redeemPromotion || redeemPromotionTransactionId) {
      record.redeemPromotion = {
        amount: redeemPromotion,
        transactionId: redeemPromotionTransactionId
      };
    }
    if (redeemOpen || redeemOpenTransactionId) {
      record.redeemOpen = {
        amount: redeemOpen,
        transactionId: redeemOpenTransactionId
      };
    }
    await this.userCardActions.insert(record);
    return record;
  }

  async findRecentCardActions(userId: string, action: CardActionType, limit = 25): Promise<UserCardActionRecord[]> {
    return await this.userCardActions.find<UserCardActionRecord>({ userId: userId, action: action }).sort({ at: -1 }).limit(limit).toArray();
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
          lastClosed: 0,
          paidToAuthor: 0,
          paidToReader: 0,
          earnedFromAuthor: 0,
          earnedFromReader: 0,
          transactionIds: [],
          like: "none"
        };
        await this.userCardInfo.insert(record);
      } catch (err) {
        record = await this.findUserCardInfo(userId, cardId);
      }
    }
    return record;
  }

  async findUserCardInfo(userId: string, cardId: string): Promise<UserCardInfoRecord> {
    return await this.userCardInfo.findOne<UserCardInfoRecord>({ userId: userId, cardId: cardId });
  }

  async findRecentCardOpens(userId: string, limit = 25, before = 0): Promise<UserCardInfoRecord[]> {
    const query: any = { userId: userId };
    query.lastOpened = before > 0 ? { $lt: before, $gt: 0 } : { $gt: 0 };
    return await this.userCardInfo.find<UserCardInfoRecord>(query).sort({ lastOpened: -1 }).limit(limit).toArray();
  }

  async updateUserCardLastImpression(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastImpression: value } });
  }

  async updateUserCardLastOpened(userId: string, cardId: string, value: number): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { lastOpened: value } });
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

  async insertBankCoupon(signedObject: SignedObject, byUserId: string, byAddress: string, timestamp: number, amount: number, budgetAmount: number, budgetPlusPercent: number, reason: BankTransactionReason, cardId: string): Promise<BankCouponRecord> {
    const record: BankCouponRecord = {
      id: uuid.v4(),
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
    return await this.bankCoupons.findOne<BankCouponRecord>({ id: id });
  }

  async incrementCouponSpent(couponId: string, amount: number): Promise<void> {
    await this.bankCoupons.updateOne({ id: couponId }, {
      $inc: { "budget.spent": amount }
    });
  }

  async insertManualWithdrawal(userId: string, transactionId: string, state: ManualWithdrawalState, created: number, amount: number, recipientContact: string): Promise<ManualWithdrawalRecord> {
    const record: ManualWithdrawalRecord = {
      id: uuid.v4(),
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
    return await this.cardStatsHistory.find({ cardId: cardId, statName: statName }).sort({ at: -1 }).limit(maxCount ? maxCount : 50).toArray();
  }

  async insertBankDeposit(status: BankDepositStatus, at: number, userId: string, amount: number, fees: number, coins: number, paymentMethodNonce: string, lastUpdatedAt: number, result: BraintreeTransactionResult): Promise<BankDepositRecord> {
    const record: BankDepositRecord = {
      id: uuid.v4(),
      status: status,
      at: at,
      userId: userId,
      amount: amount,
      fees: fees,
      coins: coins,
      paymentMethodNonce: paymentMethodNonce,
      lastUpdatedAt: lastUpdatedAt,
      result: result,
      bankTransactionId: null
    };
    await this.bankDeposits.insert(record);
    return record;
  }

  async updateBankDeposit(id: string, status: BankDepositStatus, lastUpdatedAt: number, result: BraintreeTransactionResult, bankTransactionId: string): Promise<void> {
    await this.bankDeposits.updateOne({ id: id }, {
      $set: {
        status: status,
        lastUpdatedAt: lastUpdatedAt,
        result: result,
        bankTransactionId: bankTransactionId
      }
    });
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

}

const db = new Database();

export { db };
