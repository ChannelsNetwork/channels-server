
export interface UserRecord {
  keys: UserKey[];
  address?: string;  // deprecated
  publicKey?: string; // deprecated
  added: number;
  inviteeCode: string;
  inviterCode: string;
  balance: number;
  balanceLastUpdated: number;
  inviteeReward: number;
  inviterRewards: number;
  invitationsRemaining: number;
  invitationsAccepted: number;
  lastContact: number;
  identity?: UserIdentity;
  storage: number;
  admin: boolean;
  syncCode?: string;
  syncCodeExpires?: number;
}

export interface UserKey {
  address: string;
  publicKey: string;
  added: number;
}

export interface DeviceTokenRecord {
  type: DeviceType;
  token: string;
  userAddress: string;
  added: number;
}

export type DeviceType = "web" | "ios";

export interface UserIdentity {
  name: string;
  handle: string;
  imageUrl: string;
  location: string;
  emailAddress: string;
}

export interface NetworkRecord {
  id: string;
  created: number;
  balance: number;
}

export interface CardRecord {
  id: string;
  postedAt: number;
  by: {
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
  };
  summary: {
    imageUrl: string;
    linkUrl: string;
    title: string;
    text: string;
  };
  cardType: {
    project: string;
    iconUrl: string;
  };
  pricing: {
    promotionFee: number;
    openPayment: number; // in ChannelCoin
    openFeeUnits: number; // 1 - 10
  };
  revenue: CardStatistic;
  impressions: CardStatistic;
  opens: CardStatistic;
  likes: CardStatistic;
  dislikes: CardStatistic;
  score: CardStatistic;
  lastScored: number;
  lock: {
    server: string;
    at: number;
  };
}

export interface CardStatistic {
  value: number;
  history: CardStatisticHistory[];
}

export interface CardStatisticHistory {
  value: number;
  at: number;
}

export type CardMutationType = "set-property" | "inc-property" | "add-record" | "update-record" | "update-record-field" | "inc-record-field" | "delete-record" | "move-record";
export type CardStateGroup = "user" | "shared";

export interface CardMutationRecord {
  index: number;
  mutationId: string;
  cardId: string;
  group: CardStateGroup;
  by: string;
  at: number;
  mutation: Mutation;
}

export type Mutation = SetPropertyMutation | IncrementPropertyMutation | AddRecordMutation | UpdateRecordMutation | UpdateRecordFieldMutation | IncrementRecordFieldMutation | DeleteRecordMutation | MoveRecordMutation;

export interface BaseMutation {
  type: CardMutationType;
  group: CardStateGroup;
}
export interface SetPropertyMutation extends BaseMutation {
  name: string;
  value: any;
}

export interface IncrementPropertyMutation extends BaseMutation {
  name: string;
  incrementBy: number;
}

export interface AddRecordMutation extends BaseMutation {
  collectionName: string;
  key: string;
  value: any;
  beforeKey?: string;
}

export interface UpdateRecordMutation extends BaseMutation {
  collectionName: string;
  key: string;
  value: any;
}

export interface UpdateRecordFieldMutation extends BaseMutation {
  collectionName: string;
  key: string;
  path: string;
  value: any;
}

export interface IncrementRecordFieldMutation extends BaseMutation {
  collectionName: string;
  key: string;
  path: string;
  incrementBy: number;
}

export interface DeleteRecordMutation extends BaseMutation {
  collectionName: string;
  key: string;
}

export interface MoveRecordMutation extends BaseMutation {
  collectionName: string;
  key: string;
  beforeKey: string;
}

export interface CardPropertyRecord {
  cardId: string;
  group: CardStateGroup;
  user: string;
  name: string;
  value: any;
}

export interface CardCollectionItemRecord {
  cardId: string;
  group: CardStateGroup;
  user: string;
  collectionName: string;
  key: string;
  index: number;
  value: any;
}

export type FileStatus = "started" | "aborted" | "failed" | "uploading" | "complete";

export interface FileRecord {
  id: string;
  at: number;
  status: FileStatus;
  ownerAddress: string;
  size: number;
  filename: string;
  encoding: string;
  mimetype: string;
  s3: {
    bucket: string;
    key: string;
  };
  url: string;
}

export interface MutationIndexRecord {
  id: string;
  index: number;
}

export interface NewsItemRecord {
  id: string;
  timestamp: number;
  title: string;
  text: string;
  imageUrl: string;
  linkUrl: string;
}
