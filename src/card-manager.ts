
import { CardRecord, UserRecord, CardMutationType, CardMutationRecord, CardStateGroup, Mutation, SetPropertyMutation, AddRecordMutation, UpdateRecordMutation, DeleteRecordMutation, MoveRecordMutation, IncrementPropertyMutation, UpdateRecordFieldMutation, IncrementRecordFieldMutation } from "./interfaces/db-records";
import { db } from "./db";
import { configuration } from "./configuration";
import * as AWS from 'aws-sdk';
import { awsManager, NotificationHandler, ChannelsServerNotification } from "./aws-manager";
import { Initializable } from "./interfaces/initializable";
import { socketServer, CardHandler } from "./socket-server";
import { NotifyCardPostedDetails, PostCardDetails, NotifyCardMutationDetails } from "./interfaces/socket-messages";
import { CardDescriptor } from "./interfaces/rest-services";

const CARD_LOCK_TIMEOUT = 1000 * 60;

export class CardManager implements Initializable, NotificationHandler, CardHandler {

  async initialize(): Promise<void> {
    awsManager.registerNotificationHandler(this);
    socketServer.registerCardHandler(this);
  }

  async initialize2(): Promise<void> {
    // noop
  }

  async postCard(user: UserRecord, details: PostCardDetails): Promise<CardRecord> {
    const card = await db.insertCard(user.address, user.identity.handle, user.identity.name, user.identity.imageUrl, details.imageUrl, details.linkUrl, details.title, details.text, details.cardType);
    await this.announceCard(card, user);
    return card;
  }

  async lockCard(cardId: string): Promise<CardRecord> {
    return await db.lockCard(cardId, CARD_LOCK_TIMEOUT, configuration.get('serverId'));
  }

  async unlockCard(card: CardRecord): Promise<void> {
    await db.unlockCard(card);
  }

  async mutateCard(user: UserRecord, cardId: string, mutation: Mutation): Promise<CardMutationRecord> {
    let card: CardRecord;
    try {
      card = await this.lockCard(cardId);
      if (!card) {
        return null;
      }
      switch (mutation.type) {
        case "set-property": {
          const pMutation = mutation as SetPropertyMutation;
          if (pMutation.value === 'null') {
            await db.deleteCardProperty(cardId, pMutation.group, pMutation.group === 'user' ? user.address : '', pMutation.name);
          } else {
            await db.upsertCardProperty(cardId, pMutation.group, pMutation.group === 'user' ? user.address : '', pMutation.name, pMutation.value);
          }
          break;
        }
        case "inc-property": {
          const ipMutation = mutation as IncrementPropertyMutation;
          const property = await db.findCardProperty(cardId, ipMutation.group, ipMutation.group === 'user' ? user.address : '', ipMutation.name);
          let value = 0;
          if (property) {
            if (typeof property.value === 'number') {
              value = property.value;
            }
          }
          value += ipMutation.incrementBy;
          await db.upsertCardProperty(cardId, ipMutation.group, ipMutation.group === 'user' ? user.address : '', ipMutation.name, value);
          break;
        }
        case "add-record": {
          const arMutation = mutation as AddRecordMutation;
          let newIndex: number;
          if (arMutation.beforeKey) {
            const before = await db.findCardCollectionItemRecord(card.id, arMutation.group, user.address, arMutation.collectionName, arMutation.beforeKey);
            if (before) {
              const prior = await db.findFirstCardCollectionItemRecordBeforeIndex(card.id, arMutation.group, user.address, arMutation.collectionName, before.index);
              newIndex = prior ? (before.index - prior.index) / 2.0 : before.index - 1;
            } else {
              throw new Error("No record with specified before key");
            }
          } else {
            const after = await db.findCardCollectionItemRecordLast(card.id, arMutation.group, user.address, arMutation.collectionName);
            newIndex = after ? after.index + 1 : 1;
          }
          await db.insertCardCollectionItem(card.id, arMutation.group, user.address, arMutation.collectionName, arMutation.key, newIndex, arMutation.value);
          break;
        }
        case "update-record": {
          const urMutation = mutation as UpdateRecordMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, urMutation.group, user.address, urMutation.collectionName, urMutation.key);
          if (existing) {
            await db.updateCardCollectionItemRecord(card.id, urMutation.group, user.address, urMutation.collectionName, urMutation.key, urMutation.value);
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "update-record-field": {
          const urfMutation = mutation as UpdateRecordFieldMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, urfMutation.group, user.address, urfMutation.collectionName, urfMutation.key);
          if (existing) {
            if (urfMutation.value === null) {
              await db.unsetCardCollectionItemField(card.id, urfMutation.group, user.address, urfMutation.collectionName, urfMutation.key, urfMutation.path);
            } else {
              await db.updateCardCollectionItemField(card.id, urfMutation.group, user.address, urfMutation.collectionName, urfMutation.key, urfMutation.path, urfMutation.value);
            }
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "inc-record-field": {
          const irfMutation = mutation as IncrementRecordFieldMutation;
          const existing = await db.findCardCollectionItemRecord(card.id, irfMutation.group, user.address, irfMutation.collectionName, irfMutation.key);
          if (existing) {
            await db.incrementCardCollectionItemField(card.id, irfMutation.group, user.address, irfMutation.collectionName, irfMutation.key, irfMutation.path, irfMutation.incrementBy);
          } else {
            throw new Error("No such collection item");
          }
          break;
        }
        case "delete-record": {
          const drMutation = mutation as DeleteRecordMutation;
          await db.deleteCardCollectionItemRecord(card.id, drMutation.group, user.address, drMutation.collectionName, drMutation.key);
          break;
        }
        case "move-record": {
          const mrMutation = mutation as MoveRecordMutation;
          let modifiedIndex: number;
          if (mrMutation.beforeKey) {
            const before = await db.findCardCollectionItemRecord(card.id, mrMutation.group, user.address, mrMutation.collectionName, mrMutation.beforeKey);
            if (before) {
              const prior = await db.findFirstCardCollectionItemRecordBeforeIndex(card.id, mrMutation.group, user.address, mrMutation.collectionName, before.index);
              modifiedIndex = prior ? (before.index - prior.index) / 2.0 : before.index - 1;
            } else {
              throw new Error("No record with specified before key");
            }
          } else {
            const after = await db.findCardCollectionItemRecordLast(card.id, mrMutation.group, user.address, mrMutation.collectionName);
            modifiedIndex = after ? after.index + 1 : 1;
          }
          await db.updateCardCollectionItemIndex(card.id, mrMutation.group, user.address, mrMutation.collectionName, mrMutation.key, modifiedIndex);
          break;
        }
        default:
          throw new Error("Unhandled mutation type " + mutation.type);
      }
      // The "at" must be monotonically increasing, so we guarantee this by finding the last
      // one in the group and ensuring the new at is larger than that one.
      let at = Date.now();
      const lastMutation = await db.findLastMutation(card.id, mutation.group);
      if (lastMutation && lastMutation.at >= at) {
        at = lastMutation.at + 1;
      }
      const mutationRecord = await db.insertMutation(card.id, mutation.group, user.address, mutation, at);
      await this.announceMutation(mutationRecord, user);
    } finally {
      if (card) {
        await this.unlockCard(card);
      }
    }
  }

  private async announceCard(card: CardRecord, user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'card-posted',
      user: user.address,
      card: card.id
    };
    await awsManager.sendSns(notification);
  }

  private async announceMutation(mutationRecord: CardMutationRecord, user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'mutation',
      user: user.address,
      card: mutationRecord.cardId,
      mutation: mutationRecord.mutationId
    };
    await awsManager.sendSns(notification);
  }

  async handleNotification(notification: ChannelsServerNotification): Promise<void> {
    switch (notification.type) {
      case 'card-posted':
        await this.handleCardPostedNotification(notification);
        break;
      case 'mutation':
        await this.handleMutationNotification(notification);
        break;
      default:
        throw new Error("Unhandled notification type " + notification.type);
    }
  }

  private async handleCardPostedNotification(notification: ChannelsServerNotification): Promise<void> {
    const addresses = socketServer.getOpenSocketAddresses();
    if (addresses.length === 0) {
      return;
    }
    const card = await db.findCardById(notification.card);
    if (!card) {
      console.warn("CardManager.handleCardPostedNotification: missing card", notification);
      return;
    }
    const promises: Array<Promise<void>> = [];
    for (const address of addresses) {
      // TODO: only send to users based on their feed configuration
      promises.push(this.sendCardPostedNotification(card.id, address));
    }
    await Promise.all(promises);
  }

  private async sendCardPostedNotification(cardId: string, userAddress: string): Promise<void> {
    const cardDescriptor = await this.populateCardState(cardId, userAddress);
    const details: NotifyCardPostedDetails = cardDescriptor;
    await socketServer.sendEvent([userAddress], { type: 'notify-card-posted', details: details });
  }

  private async handleMutationNotification(notification: ChannelsServerNotification): Promise<void> {
    const addresses = socketServer.getOpenSocketAddresses();
    if (addresses.length === 0) {
      return;
    }
    const card = await db.findCardById(notification.card);
    const mutation = await db.findMutationById(notification.mutation);
    if (!card || !mutation) {
      console.warn("CardManager.handleCardPostedNotification: missing card and/or mutation", notification);
      return;
    }
    const details: NotifyCardMutationDetails = {
      mutationId: mutation.mutationId,
      cardId: card.id,
      at: mutation.at,
      by: mutation.by,
      mutation: mutation.mutation
    };
    // TODO: only send to subset of addresses based on user feed
    await socketServer.sendEvent(addresses, { type: 'notify-mutation', details: details });
  }

  async populateCardState(cardId: string, userAddress: string): Promise<CardDescriptor> {
    const record = await cardManager.lockCard(cardId);
    if (!record) {
      return null;
    }
    try {
      const card: CardDescriptor = {
        id: record.id,
        at: record.at,
        by: {
          address: record.by.address,
          handle: record.by.handle,
          name: record.by.name,
          imageUrl: record.by.imageUrl
        },
        imageUrl: record.imageUrl,
        linkUrl: record.linkUrl,
        title: record.title,
        text: record.text,
        cardType: record.cardType,
        state: {
          user: {
            mutationId: null,
            properties: {},
            collections: {}
          },
          shared: {
            mutationId: null,
            properties: {},
            collections: {}
          }
        }
      };
      if (userAddress) {
        const lastUserMutation = await db.findLastMutation(card.id, "user");
        if (lastUserMutation) {
          card.state.user.mutationId = lastUserMutation.mutationId;
        }
        const userProperties = await db.findCardProperties(card.id, "user", userAddress);
        for (const property of userProperties) {
          card.state.user.properties[property.name] = property.value;
        }
        // TODO: if a lot of state information, omit it and let client ask if it
        // needs it
        const userCollectionRecords = await db.findCardCollectionItems(card.id, "user", userAddress);
        for (const item of userCollectionRecords) {
          if (!card.state.user.collections[item.collectionName]) {
            card.state.user.collections[item.collectionName] = {};
            card.state.user.collections[item.collectionName][item.key] = item.value;
          }
        }
      }
      const lastSharedMutation = await db.findLastMutation(card.id, "shared");
      if (lastSharedMutation) {
        card.state.shared.mutationId = lastSharedMutation.mutationId;
      }
      const sharedProperties = await db.findCardProperties(card.id, "shared", '');
      for (const property of sharedProperties) {
        card.state.shared.properties[property.name] = property.value;
      }
      const sharedCollectionRecords = await db.findCardCollectionItems(card.id, "shared", '');
      for (const item of sharedCollectionRecords) {
        if (!card.state.shared.collections[item.collectionName]) {
          card.state.shared.collections[item.collectionName] = {};
          card.state.shared.collections[item.collectionName][item.key] = item.value;
        }
      }
      return card;
    } finally {
      await cardManager.unlockCard(record);
    }
  }

}

const cardManager = new CardManager();

export { cardManager };
