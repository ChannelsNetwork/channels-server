import { MongoClient, Db, Collection, Cursor } from "mongodb";
import * as uuid from "uuid";

import { configuration } from "./configuration";
import { UserRecord, NetworkRecord, UserIdentity, CardRecord, FileRecord, FileStatus, CardMutationRecord, CardStateGroup, CardMutationType, CardPropertyRecord, CardCollectionItemRecord, Mutation, MutationIndexRecord, NewsItemRecord, DeviceTokenRecord, DeviceType, CardStatistic, SubsidyBalanceRecord, CardOpensRecord, CardOpensInfo, BowerManagementRecord, BankTransactionRecord, UserAccountType, CardActionType, UserCardActionRecord, UserCardInfoRecord, CardLikeState } from "./interfaces/db-records";
import { Utils } from "./utils";
import { UserHelper } from "./user-helper";
import { BankTransactionDetails } from "./interfaces/rest-services";

export class Database {
  private db: Db;
  private users: Collection;
  private networks: Collection;
  private cards: Collection;
  private mutationIndexes: Collection;
  private mutations: Collection;
  private cardProperties: Collection;
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

  async initialize(): Promise<void> {
    const serverOptions = configuration.get('mongo.serverOptions');
    const options: any = { db: { w: 1 } };
    if (serverOptions) {
      options.server = serverOptions;
    }
    this.db = await MongoClient.connect(configuration.get('mongo.mongoUrl', options));
    await this.initializeNetworks();
    await this.initializeUsers();
    await this.initializeCards();
    await this.initializeMutationIndexes();
    await this.initializeMutations();
    await this.initializeCardProperties();
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
  }

  private async initializeNetworks(): Promise<void> {
    this.networks = this.db.collection('networks');
    await this.networks.createIndex({ id: 1 }, { unique: true });
    const existing = await this.networks.findOne<NetworkRecord>({ id: "1" });
    if (!existing) {
      const record: NetworkRecord = {
        id: '1',
        created: Date.now(),
        mutationIndex: 1
      };
      await this.networks.insert(record);
    }
  }

  private async initializeUsers(): Promise<void> {
    this.users = this.db.collection('users');
    // try {
    //   const exists = await this.users.indexExists("address_1");
    //   if (exists) {
    //     await this.users.dropIndex("address_1");
    //   }
    // } catch (err) {
    //   console.log("Db.initializeUsers: error dropping obsolete index address_1", err);
    // }

    // Migrate old users with single address/publicKey to new collection
    const existing = await this.users.find<UserRecord>({ address: { $exists: true } }).toArray();
    for (const u of existing) {
      await this.users.updateOne({ address: u.address }, { $push: { keys: { address: u.address, publicKey: u.publicKey, added: u.added } }, $unset: { address: 1, publicKey: 1 } });
    }

    const noIds = await this.users.find<UserRecord>({ id: { $exists: false } }).toArray();
    for (const u of noIds) {
      await this.users.updateOne({ inviterCode: u.inviterCode }, { $set: { id: uuid.v4() } });
    }

    await this.users.createIndex({ id: 1 }, { unique: true });
    await this.users.createIndex({ "keys.address": 1 }, { unique: true });
    await this.users.createIndex({ inviterCode: 1 }, { unique: true });
    await this.users.createIndex({ "identity.handle": 1 });
    await this.users.createIndex({ type: 1, balanceLastUpdated: -1 });
    await this.users.createIndex({ type: 1, lastContact: -1 });
    await this.users.createIndex({ type: 1, balanceBelowTarget: 1 });

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
  }

  private async initializeCards(): Promise<void> {
    this.cards = this.db.collection('cards');
    await this.cards.createIndex({ id: 1 }, { unique: true });
    await this.cards.createIndex({ postedAt: -1, "by.address": -1 });
    await this.cards.createIndex({ "by.address": 1, at: -1 });
    await this.cards.createIndex({ postedAt: 1, lastScored: -1 });
    await this.cards.createIndex({ "score.value": -1 });

    // Migrate cards that don't have stats set up yet...
    const existing = await this.cards.find<CardRecord>({ opens: { $exists: false } }).toArray();
    const stat: CardStatistic = {
      value: 0,
      history: []
    };
    for (const card of existing) {
      await this.cards.updateOne({ id: card.id }, {
        $set: {
          revenue: stat,
          opens: stat,
          likes: stat,
          dislikes: stat,
          score: stat
        }
      });
    }
    await this.cards.updateMany({ lastScored: { $exists: false } }, { $set: { lastScored: 0 } });
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
        balance: 0,
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

  async ensureNetwork(balance: number): Promise<NetworkRecord> {
    const record: NetworkRecord = {
      id: '1',
      created: Date.now(),
      mutationIndex: 1
    };
    await this.networks.insert(record);
    return record;
  }

  async getNetwork(): Promise<NetworkRecord> {
    return await this.networks.findOne({ id: '1' });
  }

  async incrementNetworkBalance(incrementBy: number): Promise<void> {
    await this.networks.updateOne({ id: '1' }, { $inc: { balance: incrementBy } });
  }

  async insertUser(type: UserAccountType, address: string, publicKey: string, inviteeCode: string, inviterCode: string, invitationsRemaining: number, invitationsAccepted: number, id?: string): Promise<UserRecord> {
    const now = Date.now();
    const record: UserRecord = {
      id: id ? id : uuid.v4(),
      type: type,
      keys: [{ address: address, publicKey: publicKey, added: now }],
      added: now,
      inviteeCode: inviteeCode,
      inviterCode: inviterCode,
      balanceLastUpdated: now,
      balance: 0,
      targetBalance: 0,
      balanceBelowTarget: false,
      withdrawableBalance: 0,
      invitationsRemaining: invitationsRemaining,
      invitationsAccepted: invitationsAccepted,
      lastContact: now,
      storage: 0,
      admin: false
    };
    await this.users.insert(record);
    return record;
  }

  async updateUserBalance(userId: string, value: number): Promise<void> {
    await this.users.updateOne({ id: userId }, { $set: { balance: value } });
  }

  async updateUserAddAddress(user: UserRecord, newAddress: string, newPublicKey: string): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $push: { keys: { address: newAddress, publicKey: newPublicKey } } });
    user.keys.push({ address: newAddress, publicKey: newPublicKey, added: Date.now() });
  }

  async updateUserSyncCode(user: UserRecord, syncCode: string, syncCodeExpires: number): Promise<void> {
    await this.users.updateOne({ id: user.id }, { $set: { syncCode: syncCode, syncCodeExpires: syncCodeExpires } });
    user.syncCode = syncCode;
    user.syncCodeExpires = syncCodeExpires;
  }

  async findUserById(id: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ id: id });
  }

  async findUserByAddress(address: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "keys.address": address });
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

  async findUserByHandle(handle: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "identity.handle": handle.toLowerCase() });
  }

  async updateLastUserContact(userRecord: UserRecord, lastContact: number): Promise<void> {
    await this.users.updateOne({ id: userRecord.id }, { $set: { lastContact: lastContact } });
    userRecord.lastContact = lastContact;
  }

  async updateUserRemoveAddress(address: string): Promise<void> {
    await this.users.updateOne({ "keys.address": address }, { $pull: { keys: { address: address } } });
  }

  async deleteUser(address: string): Promise<void> {
    await this.users.deleteOne({ "keys.address": address });
  }

  async updateUserIdentity(userRecord: UserRecord, name: string, handle: string, imageUrl: string, location: string, emailAddress: string): Promise<void> {
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
    if (typeof name !== 'undefined') {
      update["identity.name"] = name;
      userRecord.identity.name = name;
    }
    if (typeof handle !== 'undefined') {
      update["identity.handle"] = handle;
      userRecord.identity.handle = handle;
    }
    if (typeof imageUrl !== 'undefined') {
      update["identity.imageUrl"] = imageUrl;
      userRecord.identity.imageUrl = imageUrl;
    }
    if (typeof location !== 'undefined') {
      update["identity.location"] = location;
      userRecord.identity.location = location;
    }
    if (typeof emailAddress !== 'undefined') {
      update["identity.emailAddress"] = emailAddress;
      userRecord.identity.emailAddress = emailAddress;
    }
    await this.users.updateOne({ id: userRecord.id }, { $set: update });
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

  async incrementUserBalance(user: UserRecord, incrementBalanceBy: number, incrementTargetBy: number, balanceBelowTarget: boolean, now: number, onlyIfLastBalanceUpdated = 0): Promise<void> {
    const query: any = {
      id: user.id
    };
    if (onlyIfLastBalanceUpdated) {
      query.balanceLastUpdated = onlyIfLastBalanceUpdated;
    }
    const result = await this.users.updateOne(query, {
      $inc: { balance: incrementBalanceBy, targetBalance: incrementTargetBy },
      $set: { balanceBelowTarget: balanceBelowTarget, balanceLastUpdated: now }
    });
    if (result.modifiedCount > 0) {
      user.balance += incrementBalanceBy;
      user.targetBalance += incrementTargetBy;
      user.balanceBelowTarget = balanceBelowTarget;
      user.balanceLastUpdated = now;
    } else {
      const updatedUser = await this.findUserById(user.id);
      if (updatedUser) {
        user.balance = updatedUser.balance;
        user.targetBalance = updatedUser.targetBalance;
        user.balanceBelowTarget = updatedUser.balanceBelowTarget;
        user.balanceLastUpdated = updatedUser.balanceLastUpdated;
      }
    }
  }

  async countUsersbalanceBelowTarget(): Promise<number> {
    return await this.users.count({ type: "normal", balanceBelowTarget: true });
  }

  async insertCard(byUserId: string, byAddress: string, byHandle: string, byName: string, byImageUrl: string, cardImageUrl: string, linkUrl: string, title: string, text: string, cardType: string, cardTypeIconUrl: string, promotionFee: number, openPayment: number, openFeeUnits: number): Promise<CardRecord> {
    const now = Date.now();
    const record: CardRecord = {
      id: uuid.v4(),
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
        linkUrl: linkUrl,
        title: title,
        text: text,
      },
      cardType: {
        package: cardType,
        iconUrl: cardTypeIconUrl
      },
      pricing: {
        promotionFee: promotionFee,
        openPayment: openPayment,
        openFeeUnits: openFeeUnits
      },
      revenue: { value: 0, history: [] },
      opens: { value: 0, history: [] },
      impressions: { value: 0, history: [] },
      likes: { value: 0, history: [] },
      dislikes: { value: 0, history: [] },
      score: { value: 0, history: [] },
      lastScored: now,
      lock: {
        server: '',
        at: 0
      }
    };
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

  async findCardById(id: string): Promise<CardRecord> {
    if (!id) {
      return null;
    }
    return await this.cards.findOne<CardRecord>({ id: id });
  }

  async findCardsForScoring(postedAfter: number, scoredBefore: number): Promise<CardRecord[]> {
    return await this.cards.find<CardRecord>({ postedAt: { $gt: postedAfter }, lastScored: { $lt: scoredBefore } }).toArray();
  }

  async findAllCards(): Promise<CardRecord[]> {
    return await this.cards.find<CardRecord>({}).toArray();
  }

  async updateCardScore(card: CardRecord, score: number, addHistory: boolean): Promise<void> {
    const now = Date.now();
    const update: any = { $set: { "score.value": score, lastScored: now } };
    if (addHistory) {
      update.$push = { "score.history": { value: score, at: now } };
    }
    await this.cards.updateOne({ id: card.id }, update);
    card.score.value = score;
    card.lastScored = now;
  }

  async updateCardStats_Preview(cardId: string, postedAgo: number, revenue: number, likes: number, dislikes: number): Promise<void> {
    const now = Date.now();
    await this.cards.updateOne({ id: cardId }, {
      $set: {
        postedAt: now - postedAgo,
        "revenue.value": revenue,
        "likes.value": likes,
        "dislikes.value": dislikes
      }
    });
  }

  async clearCardScoreHistoryBefore(card: CardRecord, before: number): Promise<void> {
    await this.cards.updateOne({ id: card.id }, { $pull: { history: { at: { $lte: before } } } });
  }

  async findCards(beforeCard: CardRecord, afterCard: CardRecord, maxCount: number): Promise<CardRecord[]> {
    let cursor = this.cards.find();
    let anyCursor = cursor as any;  // appears to be a bug in type definitions related to max/min
    if (afterCard) {
      anyCursor = anyCursor.min({ postedAt: afterCard.postedAt, "by.address": afterCard.by.address });
    }
    if (beforeCard) {
      anyCursor = anyCursor.max({ postedAt: beforeCard.postedAt, "by.address": beforeCard.by.address });
    }
    cursor = anyCursor as Cursor<CardRecord>;
    return await cursor.sort({ postedAt: -1, byAddress: -1 }).limit(maxCount).toArray();
  }

  async findCardsByTime(before: number, after: number, maxCount: number, byUserId?: string): Promise<CardRecord[]> {
    const query: any = {};
    if (byUserId) {
      query["by.id"] = byUserId;
    }
    if (before && after) {
      query.postedAt = { $lt: before, $gt: after };
    } else if (before) {
      query.postedAt = { $lt: before };
    } else if (after) {
      query.postedAt = { $gt: after };
    }
    return this.cards.find(query).sort({ postedAt: -1 }).limit(maxCount).toArray();
  }

  async findCardsByScore(limit: number): Promise<CardRecord[]> {
    return await this.cards.find({}).sort({ "score.value": -1 }).limit(limit).toArray();
  }

  async incrementCardLikes(cardId: string, incrementLikesBy: number, incrementDislikesBy: number): Promise<void> {
    await this.cards.updateOne({ id: cardId }, {
      $inc: {
        "likes.value": incrementLikesBy,
        "dislikes.value": incrementDislikesBy
      }
    });
  }

  async incrementCardImpressions(cardId: string, incrementBy: number): Promise<void> {
    await this.cards.updateOne({ id: cardId }, { $inc: { "impressions.value": incrementBy } });
  }

  async incrementCardOpens(cardId: string, incrementBy: number): Promise<void> {
    await this.cards.updateOne({ id: cardId }, { $inc: { "opens.value": incrementBy } });
  }

  async incrementCardRevenue(cardId: string, incrementBy: number): Promise<void> {
    await this.cards.updateOne({ id: cardId }, { $inc: { "revenue.value": incrementBy } });
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

  async findCardCollectionItems(cardId: string, group: CardStateGroup, user: string): Promise<CardCollectionItemRecord[]> {
    return await this.cardCollectionItems.find<CardCollectionItemRecord>({ cardId: cardId, group: group, user: user }).sort({ collectionName: 1, index: 1 }).toArray();
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

  async insertBankTransaction(at: number, originatorUserId: string, participantUserIds: string[], details: BankTransactionDetails, signature: string): Promise<BankTransactionRecord> {
    const record: BankTransactionRecord = {
      id: uuid.v4(),
      at: at,
      originatorUserId: originatorUserId,
      participantUserIds: participantUserIds,
      details: details,
      signature: signature
    };
    await this.bankTransactions.insert(record);
    return record;
  }

  async findBankTransactionById(id: string): Promise<BankTransactionRecord> {
    return await db.bankTransactions.findOne<BankTransactionRecord>({ id: id });
  }

  async findBankTransactionByParticipant(participantUserId: string, limit = 500): Promise<BankTransactionRecord[]> {
    return await db.bankTransactions.find<BankTransactionRecord>({ participantUserIds: participantUserId }).sort({ "details.timestamp": -1 }).limit(limit).toArray();
  }

  async countBankTransactions(): Promise<number> {
    return await db.bankTransactions.count({});
  }

  async insertUserCardAction(userId: string, cardId: string, at: number, action: CardActionType, payment?: number, paymentTransactionId?: string): Promise<UserCardActionRecord> {
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
          payment: 0,
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

  async findRecentCardOpens(userId: string, limit = 25): Promise<UserCardInfoRecord[]> {
    return await this.userCardInfo.find<UserCardInfoRecord>({ userId: userId, lastOpened: { $gt: 0 } }).sort({ lastOpened: -1 }).limit(limit).toArray();
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

  async updateUserCardIncrementPayment(userId: string, cardId: string, amount: number, transactionId: string): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $inc: { payment: amount }, $push: { transactionIds: transactionId } });
  }

  async updateUserCardInfoLikeState(userId: string, cardId: string, state: CardLikeState): Promise<void> {
    await this.ensureUserCardInfo(userId, cardId);
    await this.userCardInfo.updateOne({ userId: userId, cardId: cardId }, { $set: { like: state } });
  }
}

const db = new Database();

export { db };
