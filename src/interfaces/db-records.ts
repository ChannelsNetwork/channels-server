
import { Signable, BankTransactionDetails, BowerInstallResult, ChannelComponentDescriptor } from "./rest-services";
import { SignedObject } from "./signed-object";

export interface UserRecord {
  id: string;
  type: UserAccountType;
  address: string;
  publicKey: string;
  addressHistory: UserAddressHistory[];
  encryptedPrivateKey: string;
  added: number;
  inviteeCode: string;
  inviterCode: string;
  balance: number;
  minBalanceAfterWithdrawal: number;
  targetBalance: number;
  balanceLastUpdated: number;
  balanceBelowTarget: boolean;
  invitationsRemaining: number;
  invitationsAccepted: number;
  lastContact: number;
  lastPosted: number;
  lastWithdrawal: number;
  identity?: UserIdentity;
  storage: number;
  admin: boolean;
  recoveryCode?: string;
  recoveryCodeExpires?: number;
  ipAddresses: string[];
  marketing: UserMarketingInfo;
  country?: string;
  region?: string;
  city?: string;
  zip?: string;
  curation?: UserCurationType;
  originalReferrer: string;
  originalLandingPage: string;
  notifications?: {
    disallowAnnouncements?: boolean;
    disallowContentNotifications?: boolean;
    lastContentNotification?: number;
  };
}

export type UserCurationType = "blocked" | "discounted";

export type UserStatus = "active" | "deleted";

export interface UserMarketingInfo {
  includeInMailingList: boolean;
}

export interface OldUserRecord {
  id: string;
  keys: OldUserKey[];
  added: number;
  balance: number;
  balanceLastUpdated: number;
  lastContact: number;
  storage: number;
  admin: boolean;
  targetBalance: number;
  withdrawableBalance: number;
  balanceBelowTarget: boolean;
  identity?: UserIdentity;
}

export interface OldUserKey {
  address: string;
  publicKey: string;
  added: number;
}

export interface UserAddressHistory {
  address: string;
  publicKey: string;
  added: number;
}

export type UserAccountType = "normal" | "network" | "networkDeveloper";

export interface UserIdentity {
  name: string;
  handle: string;
  imageUrl?: string;  // obsolete
  imageId: string;
  location: string;
  emailAddress: string;
  emailConfirmed: boolean;
  emailConfirmationCode: string;
  emailLastConfirmed: number;
  firstName: string;
  lastName: string;
}

export interface NetworkRecord {
  id: string;
  created: number;
  mutationIndex: number;
  totalPublisherRevenue: number;
  totalCardDeveloperRevenue: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalPublisherSubsidies: number;
}

export interface CardRecord {
  id: string;
  state: CardActiveState;
  postedAt: number;
  createdById: string;
  by?: {  // obsolete
    id: string;
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
  };
  summary: {
    imageId: string;
    imageUrl?: string;  // obsolete
    imageWidth?: number; // obsolete
    imageHeight?: number; // obsolete
    linkUrl: string;
    title: string;
    text: string;
  };
  keywords: string[];
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
  coupon?: SignedObject; // obsolete
  couponId?: string; // obsolete
  coupons: SignedObject[];
  couponIds: string[];
  budget: {
    amount: number;
    plusPercent: number;
    spent: number;
    available: boolean;
  };
  stats: CardStatistics;
  score: number;
  lastScored: number;
  promotionScores: CardPromotionScores;
  lock: {
    server: string;
    at: number;
  };
  curation?: {
    block?: boolean;
    boost?: number;
    boostAt?: number;
  };
  searchText: string;
  type: CardType;
  fileIds: string[];
}

export type CardType = "normal" | "announcement";

export interface CardPromotionScores {
  a: number;  // balance/target > 80%
  b: number;
  c: number;
  d: number;
  e: number;  // balance/target < 20%
}

export type CardPromotionBin = "a" | "b" | "c" | "d" | "e";

export interface CardStatistics {
  revenue: CardStatistic;
  promotionsPaid: CardStatistic;
  openFeesPaid: CardStatistic;
  impressions: CardStatistic;
  uniqueImpressions: CardStatistic;
  opens: CardStatistic;
  clicks: CardStatistic;
  uniqueOpens: CardStatistic;
  uniqueClicks: CardStatistic;
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

export interface CardCollectionRecord {
  cardId: string;
  group: CardStateGroup;
  user: string;
  collectionName: string;
  keyField?: string;
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

export interface CardFileRecord {
  cardId: string;
  group: CardStateGroup;
  user: string;
  fileId: string;
  key: string;
}

export type FileStatus = "started" | "aborted" | "failed" | "uploading" | "complete" | "final" | "deleted";

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
  imageInfo: ImageInfo;
}

export interface ImageInfo {
  width: number;
  height: number;
}

export interface MutationIndexRecord {
  id: string;
  index: number;
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
  fromIpAddress: string;
  fromFingerprint: string;
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

export type CardActionType = "impression" | "open" | "pay" | "close" | "like" | "reset-like" | "dislike" | "redeem-promotion" | "redeem-open-payment" | "make-private" | "make-public" | "click";

export interface UserCardInfoRecord {
  userId: string;
  cardId: string;
  created: number;
  lastImpression: number;
  lastOpened: number;
  lastClicked: number;
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

export type BankTransactionReason = "card-promotion" | "card-open-payment" | "card-open-fee" | "interest" | "subsidy" | "grant" | "inviter-reward" | "invitee-reward" | "withdrawal" | "deposit" | "publisher-subsidy";

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

export type ManualWithdrawalState = "pending" | "canceled" | "paid" | "denied";

export type BankDepositStatus = "pending" | "failed" | "completed";

export interface BowerPackageRecord {
  packageName: string;
  installed: number;
  package: string;  // stringified BowerInstallResult;
  channelComponent: ChannelComponentDescriptor;
}

export interface PublisherSubsidyDayRecord {
  starting: number;  // start date
  totalCoins: number;
  coinsPerPaidOpen: number;
  coinsPaid: number;
  returnUserBonus: number;
}

export interface CardTopicRecord {
  id: string;
  status: CardTopicStatus;
  topicNoCase: string;
  topicWithCase: string;
  keywords: string[];
  added: number;
}

export type CardTopicStatus = "active" | "hidden";

export interface NetworkCardStatsHistoryRecord {
  periodStarting: number;
  isCurrent: boolean;
  stats: NetworkCardStats;
}

export interface NetworkCardStats {
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  paidOpens: number;
  likes: number;
  dislikes: number;
  cardRevenue: number;
  blockedPaidOpens: number;
}

export interface IpAddressRecord {
  ipAddress: string;
  created: number;
  lastUpdated: number;

  status: IpAddressStatus;
  country: string;
  countryCode: string;
  region: string;
  regionName: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  "as": string;
  query: string;
  message: string;
}

export type IpAddressStatus = "success" | "fail";

export interface ChannelRecord {
  id: string;
  status: ChannelStatus;
  name: string;
  handle: string;
  ownerId: string;
  created: number;
  bannerImageFileId: string;
  about: string;
  linkUrl: string;
  socialLinks: SocialLink[];
  stats: ChannelStats;
  lastStatsSnapshot: number;
  latestCardPosted: number;
  keywords: string[];
}

export type ChannelStatus = "active" | "deleted";

export interface ChannelStats {
  subscribers: number;
  cards: number;
  revenue: number;
}

export interface SocialLink {
  network: SocialNetwork;
  link: string;
}

export type SocialNetwork = "Facebook" | "Twitter" | "Instagram" | "Snapchat" | "YouTube" | "Twitch" | "WeChat" | "Pinterest" | "LinkedIn";

export interface ChannelUserRecord {
  channelId: string;
  userId: string;
  added: number;
  lastCardPosted: number;
  subscriptionState: ChannelSubscriptionState;
  lastUpdated: number;
  notificationPending: boolean;
  lastNotification: number;
  lastVisited: number;
}

export type ChannelSubscriptionState = "subscribed" | "unsubscribed" | "blocked";

export interface ChannelCardRecord {
  channelId: string;
  cardId: string;
  cardPostedAt: number;
  added: number;
}

export interface UserRegistrationRecord {
  userId: string;
  at: number;
  ipAddress: string;
  fingerprint: string;
  address: string;
  referrer: string;
  landingPage: string;
}

export interface ChannelKeywordRecord {
  channelId: string;
  keyword: string;
  cardCount: number;
  lastUsed: number;
}
