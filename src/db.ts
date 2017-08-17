import { MongoClient, Db, Collection } from "mongodb";

import { configuration } from "./configuration";
import { UserRecord, NetworkRecord, UserIdentity } from "./interfaces/db-records";

export class Database {
  private db: Db;
  private users: Collection;
  private networks: Collection;

  async initialize(): Promise<void> {
    const serverOptions = configuration.get('mongo.serverOptions');
    const options: any = { db: { w: 1 } };
    if (serverOptions) {
      options.server = serverOptions;
    }
    this.db = await MongoClient.connect(configuration.get('mongo.mongoUrl', options));
    await this.initializeNetworks();
    await this.initializeUsers();

  }

  private async initializeNetworks(): Promise<void> {
    this.networks = this.db.collection('networks');
    await this.networks.createIndex({ id: 1 }, { unique: true });
  }

  private async initializeUsers(): Promise<void> {
    this.users = this.db.collection('users');
    await this.users.createIndex({ address: 1 }, { unique: true });
    await this.users.createIndex({ inviterCode: 1 }, { unique: true });
    await this.users.createIndex({ iosDeviceTokens: 1 }, { unique: true, sparse: true });
    await this.users.createIndex({ "identity.handle": 1 }, { unique: true, sparse: true });
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
      lastContact: now
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

  async updateUserIdentity(userRecord: UserRecord, name: string, handle: string): Promise<void> {
    const identity: UserIdentity = {
      name: name,
      handle: handle.toLowerCase()
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
}

const db = new Database();

export { db };
