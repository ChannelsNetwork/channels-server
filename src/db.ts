import { MongoClient, Db, Collection, Cursor } from "mongodb";
import * as uuid from "uuid";

import { configuration } from "./configuration";
import { UserRecord, NetworkRecord, UserIdentity, CardRecord, FileRecord, FileStatus, CardMutationRecord, CardStateGroup, CardMutationType, CardPropertyRecord, CardCollectionItemRecord, Mutation, MutationIndexRecord } from "./interfaces/db-records";
import { Utils } from "./utils";

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
  }

  private async initializeNetworks(): Promise<void> {
    this.networks = this.db.collection('networks');
    await this.networks.createIndex({ id: 1 }, { unique: true });
  }

  private async initializeUsers(): Promise<void> {
    this.users = this.db.collection('users');
    await this.users.createIndex({ address: 1 }, { unique: true });
    await this.users.createIndex({ inviterCode: 1 }, { unique: true });
    await this.users.createIndex({ iosDeviceTokens: 1 });
    await this.users.createIndex({ "identity.handle": 1 });
  }

  private async initializeCards(): Promise<void> {
    this.cards = this.db.collection('cards');
    await this.cards.createIndex({ id: 1 }, { unique: true });
    await this.cards.createIndex({ at: -1, "by.address": -1 });
    await this.cards.createIndex({ "by.address": 1, at: -1 });
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

  async insertNetwork(balance: number): Promise<NetworkRecord> {
    const record: NetworkRecord = {
      id: '1',
      created: Date.now(),
      balance: balance
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

  async insertUser(address: string, publicKey: string, inviteeCode: string, inviterCode: string, balance: number, inviteeReward: number, inviterRewards: number, invitationsRemaining: number, invitationsAccepted: number): Promise<UserRecord> {
    const now = Date.now();
    const record: UserRecord = {
      address: address,
      publicKey: publicKey,
      added: now,
      inviteeCode: inviteeCode,
      inviterCode: inviterCode,
      balance: balance,
      inviteeReward: inviteeReward,
      inviterRewards: inviterRewards,
      invitationsRemaining: invitationsRemaining,
      invitationsAccepted: invitationsAccepted,
      iosDeviceTokens: [],
      lastContact: now,
      storage: 0
    };
    await this.users.insert(record);
    return record;
  }

  async findUserByAddress(address: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ address: address });
  }

  async findUserByInviterCode(code: string): Promise<UserRecord> {
    if (!code) {
      return null;
    }
    return await this.users.findOne<UserRecord>({ inviterCode: code.toLowerCase() });
  }

  async findUserByIosToken(token: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ iosDeviceTokens: token });
  }

  async findUserByHandle(handle: string): Promise<UserRecord> {
    return await this.users.findOne<UserRecord>({ "identity.handle": handle.toLowerCase() });
  }

  async updateLastUserContact(userRecord: UserRecord, lastContact: number): Promise<void> {
    await this.users.updateOne({ address: userRecord.address }, { $set: { lastContact: lastContact } });
    userRecord.lastContact = lastContact;
  }

  async appendUserIosToken(userRecord: UserRecord, token: string): Promise<void> {
    await this.users.updateOne({ address: userRecord.address }, { $push: { iosDeviceTokens: token } });
    userRecord.iosDeviceTokens.push(token);
  }

  async updateUserIdentity(userRecord: UserRecord, name: string, handle: string, imageUrl: string, location: string): Promise<void> {
    const identity: UserIdentity = {
      name: name,
      handle: handle.toLowerCase(),
      imageUrl: imageUrl,
      location: location
    };
    await this.users.updateOne({ address: userRecord.address }, { $set: { identity: identity } });
    userRecord.identity = identity;
  }

  async incrementInvitationsAccepted(user: UserRecord, reward: number): Promise<void> {
    await this.users.updateOne({ address: user.address }, {
      $inc: {
        balance: reward,
        inviterRewards: reward,
        invitationsRemaining: -1,
        invitationsAccepted: 1
      }
    });
    user.balance += reward;
    user.inviterRewards += reward;
    user.invitationsRemaining--;
    user.invitationsAccepted++;
  }

  async incrementUserStorage(user: UserRecord, size: number): Promise<void> {
    await this.users.updateOne({ address: user.address }, {
      $inc: {
        storage: size
      }
    });
    user.storage += size;
  }

  async insertCard(byAddress: string, byHandle: string, byName: string, byImageUrl: string, cardImageUrl: string, linkUrl: string, title: string, text: string, cardType: string): Promise<CardRecord> {
    const now = Date.now();
    const record: CardRecord = {
      id: uuid.v4(),
      at: now,
      by: {
        address: byAddress,
        handle: byHandle,
        name: byName,
        imageUrl: byImageUrl
      },
      imageUrl: cardImageUrl,
      linkUrl: linkUrl,
      title: title,
      text: text,
      cardType: cardType,
      lock: {
        server: '',
        at: 0
      }
    };
    await this.cards.insert(record);
    return record;
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
        const updateResult = await this.cards.updateOne({ id: cardId, "lock.server": card.lock.server, "lock.at": card.lock.at }, { $set: { lock: lock } });
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

  async findCards(beforeCard: CardRecord, afterCard: CardRecord, maxCount: number): Promise<CardRecord[]> {
    let cursor = this.cards.find();
    let anyCursor = cursor as any;  // appears to be a bug in type definitions related to max/min
    if (afterCard) {
      anyCursor = anyCursor.min({ at: afterCard.at, "by.address": afterCard.by.address });
    }
    if (beforeCard) {
      anyCursor = anyCursor.max({ at: beforeCard.at, "by.address": beforeCard.by.address });
    }
    cursor = anyCursor as Cursor<CardRecord>;
    return await cursor.sort({ at: -1, byAddress: -1 }).limit(maxCount).toArray();
  }

  async findCardsByTime(before: number, after: number, maxCount: number): Promise<CardRecord[]> {
    const query: any = {};
    if (before) {
      query.before = { $lt: before };
    }
    if (after) {
      query.after = { $gt: after };
    }
    return this.cards.find(query).sort({ at: -1 }).limit(maxCount).toArray();
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
      ownerAddress: null,
      size: 0,
      filename: null,
      encoding: null,
      mimetype: null,
      s3: {
        bucket: s3Bucket,
        key: null
      }
    };
    await this.files.insert(record);
    return record;
  }

  async updateFileStatus(fileRecord: FileRecord, status: FileStatus): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, { $set: { status: status } });
    fileRecord.status = status;
  }

  async updateFileProgress(fileRecord: FileRecord, ownerAddress: string, filename: string, encoding: string, mimetype: string, s3Key: string, status: FileStatus): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: {
        ownerAddress: ownerAddress,
        filename: filename,
        encoding: encoding,
        mimetype: mimetype,
        "s3.key": s3Key,
        status: status
      }
    });
    fileRecord.ownerAddress = ownerAddress;
    fileRecord.filename = filename;
    fileRecord.encoding = encoding;
    fileRecord.mimetype = mimetype;
    fileRecord.s3.key = s3Key;
    fileRecord.status = status;
  }

  async updateFileCompletion(fileRecord: FileRecord, status: FileStatus, size: number): Promise<void> {
    await this.files.updateOne({ id: fileRecord.id }, {
      $set: {
        status: status,
        size: size
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

}

const db = new Database();

export { db };
