
import { Signable, BankTransactionDetails } from "./rest-services";
import { SignedObject } from "./signed-object";

export interface UserRecord {
  id: string;
  type: UserAccountType;
  address: string;
  publicKey: string;
  encryptedPrivateKey: string;
  added: number;
  inviteeCode: string;
  inviterCode: string;
  balance: number;
  withdrawableBalance: number;
  targetBalance: number;
  balanceLastUpdated: number;
  balanceBelowTarget: boolean;
  invitationsRemaining: number;
  invitationsAccepted: number;
  lastContact: number;
  identity?: UserIdentity;
  storage: number;
  admin: boolean;
  recoveryCode?: string;
  recoveryCodeExpires?: number;
}

export type UserAccountType = "normal" | "network" | "networkDeveloper";

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
  mutationIndex: number;
}

export interface CardRecord {
  id: string;
  state: CardActiveState;
  postedAt: number;
  by: {
    id: string;
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
  };
  summary: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    linkUrl: string;
    title: string;
    text: string;
  };
  private: boolean;
  cardType: {
    package: string;
    iconUrl: string;
    royaltyAddress: string;
    royaltyFraction: number;
  };
  pricing: {
    promotionFee: number;
    openPayment: number; // in ChannelCoin
    openFeeUnits: number; // 1 - 10
  };
  coupon: SignedObject;
  couponId: string;
  budget: {
    amount: number;
    plusPercent: number;
    spent: number;
  };
  stats: CardStatistics;
  score: number;
  lastScored: number;
  lock: {
    server: string;
    at: number;
  };
}

export interface CardStatistics {
  revenue: CardStatistic;
  promotionsPaid: CardStatistic;
  openFeesPaid: CardStatistic;
  impressions: CardStatistic;
  uniqueImpressions: CardStatistic;
  opens: CardStatistic;
  uniqueOpens: CardStatistic;
  likes: CardStatistic;
  dislikes: CardStatistic;
}

export interface CardStatistic {
  value: number;
  lastSnapshot: number;
}

export type CardActiveState = "active" | "deleted";

export interface CardStatisticHistoryRecord {
  cardId: string;
  statName: string;
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
  ownerId: string;
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

export interface SubsidyBalanceRecord {
  id: string;
  balance: number;
  totalContributions: number;
  totalPayments: number;
  lastContribution: number;
}

export interface CardOpensRecord {
  periodStarted: number;
  periodEnded: number;
  thisPeriod: CardOpensInfo;
  total: CardOpensInfo;
}

export interface CardOpensInfo {
  opens: number;
  units: number;
}

export interface BowerManagementRecord {
  id: string;
  serverId: string;
  status: string;
  timestamp: number;
}
export interface BankTransactionRecord {
  id: string;
  at: number;
  originatorUserId: string;
  participantUserIds: string[];
  deductions: number;
  remainderShares: number;
  relatedCardTitle: string;
  details: BankTransactionDetails;
  recipientUserIds: string[];
  signedObject: SignedObject;
  withdrawalInfo?: {
    type: string;
    referenceId: string;
    status: string;
    error: any;
  };
}

export interface UserCardActionRecord {
  id: string;
  userId: string;
  cardId: string;
  at: number;
  action: CardActionType;
  payment?: {
    amount: number;
    transactionId: string;
  };
  redeemPromotion?: {
    amount: number;
    transactionId: string;
  };
  redeemOpen?: {
    amount: number;
    transactionId: string;
  };
}

export type CardActionType = "impression" | "open" | "pay" | "close" | "like" | "reset-like" | "dislike" | "redeem-promotion" | "redeem-open-payment" | "make-private" | "make-public";

export interface UserCardInfoRecord {
  userId: string;
  cardId: string;
  created: number;
  lastImpression: number;
  lastOpened: number;
  lastClosed: number;
  paidToAuthor: number;
  paidToReader: number;
  earnedFromAuthor: number;
  earnedFromReader: number;
  transactionIds: string[];
  like: CardLikeState;
}

export type CardLikeState = "none" | "like" | "dislike";

export interface BankCouponRecord {
  id: string;
  signedObject: SignedObject;
  byUserId: string;
  byAddress: string;
  timestamp: number;
  amount: number;
  budget: {
    amount: number;
    plusPercent: number;
    spent: number;
  };
  reason: BankTransactionReason;
  cardId: string;
}

export type BankTransactionReason = "card-promotion" | "card-open-payment" | "card-open-fee" | "interest" | "subsidy" | "grant" | "inviter-reward" | "invitee-reward" | "withdrawal";

export interface BankCouponDetails extends Signable {
  reason: BankTransactionReason;
  amount: number;
  budget: {
    amount: number;
    plusPercent: number;
  };
}

export interface ManualWithdrawalRecord {
  id: string;
  userId: string;
  transactionId: string;
  state: ManualWithdrawalState;
  created: number;
  amount: number;
  recipientContact: string;
  lastUpdated: number;
  lastUpdatedBy: string;
  paymentReferenceId: string;
}

export type ManualWithdrawalState = "pending" | "canceled" | "paid";
