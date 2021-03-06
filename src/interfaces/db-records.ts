
import { Signable, BankTransactionDetails, BowerInstallResult, ChannelComponentDescriptor, ReportCardReason } from "./rest-services";
import { SignedObject } from "./signed-object";

export interface UserRecord {
  id: string;
  sessionId: string;
  type: UserAccountType;
  address: string;
  publicKey: string;
  addressHistory: UserAddressHistory[];
  encryptedPrivateKey: string;
  added: number;
  balance: number;
  balanceLastUpdated: number;
  balanceBelowTarget: boolean;
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
    disallowPlatformNotifications?: boolean;
    disallowContentNotifications?: boolean;
    disallowCommentNotifications?: boolean;
    lastContentNotification?: number;
    lastCommentNotification?: number;
  };
  homeChannelId: string;
  firstCardPurchasedId: string;
  firstArrivalCardId: string;
  referralBonusPaidToUserId: string;
  lastLanguagePublished: string;
  preferredLangCodes: string[];
  commentsLastReviewed: number;
  commentNotificationPending?: boolean;
  initialBalance: number;
}

export type UserCurationType = "blocked" | "discounted";

export type CommentCurationType = "blocked";

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
  maxPayoutPerBaseFeePeriod: number;
  cardPurchaseStatsUpdated: boolean;
}

export interface CardRecord {
  id: string;
  sessionId: string;
  state: CardActiveState;
  postedAt: number;
  createdById: string;
  by: {
    id?: string;  // obsolete
    address: string;
    handle: string;
    name: string;
    imageUrl?: string;  // obsolete
  };
  summary: {
    imageId: string;
    imageUrl?: string;  // obsolete
    imageWidth?: number; // obsolete
    imageHeight?: number; // obsolete
    linkUrl: string;
    iframeUrl: string;
    title: string;
    text: string;
    langCode: string; // ISO 639-1 code such as 'en'
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
    promotionFee?: number; // obsolete
    openPayment?: number; //  obsolete
    openFeeUnits: number; // 1 - 10
  };
  couponIds?: string[];  // obsolete
  budget?: {  // obsolete
    amount: number;
    plusPercent: number;
    spent: number;
    available: boolean;
  };
  stats: CardStatistics;
  score: number;
  lastScored: number;
  lock: {
    server: string;
    at: number;
  };
  curation: {
    quality: CardCurationQuality;
    market?: boolean;
    block?: boolean;
    boost?: number;
    promotionBoost?: number;
    boostAt?: number;
    reported?: boolean;
    overrideReports?: boolean;
  };
  searchText: string;
  type: CardType;
  fileIds: string[];
}

export type CardCurationQuality = "excellent" | "good" | "poor" | "unrated";

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
  clickFeesPaid: CardStatistic;
  impressions: CardStatistic;
  uniqueImpressions: CardStatistic;
  opens: CardStatistic;
  clicks: CardStatistic;
  uniqueOpens: CardStatistic;
  uniqueClicks: CardStatistic;
  likes: CardStatistic;
  dislikes: CardStatistic;
  reports: CardStatistic;
  refunds: CardStatistic;
  fraudPurchases: CardStatistic;
  normalPurchases: CardStatistic;
  firstTimePurchases: CardStatistic;
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
  sessionId: string;
  at: number;
  originatorUserId: string;
  participantUserIds: string[];
  participantBalancesBefore: number[];
  participantBalancesAfter: number[];
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
  refunded: boolean;
  refundInfo?: BankTransactionRefundInfo;
  description: string;
  fromIpAddress: string;
  fromFingerprint: string;
}

export interface BankTransactionRefundInfo {
  at: number;
  reason: BankTransactionRefundReason;
}

export type BankTransactionRefundReason = "user-card-report";

export interface UserCardActionRecord {
  id: string;
  sessionId: string;
  userId: string;
  fromIpAddress?: string; // obsolete, now part of geo
  fromFingerprint?: string; // obsolete, now part of geo
  referringUserId: string;
  cardId: string;
  authorId: string;
  at: number;
  action: CardActionType;
  fraudReason?: CardPaymentFraudReason;
  payment?: UserCardActionPaymentInfo;
  report?: UserCardActionReportInfo;
  redeemPromotion?: {
    amount: number;
    transactionId: string;
    cardCampaignId: string;
  };
  redeemAdImpression?: {
    amount: number;
    transactionId: string;
    cardCampaignId: string;
  };
  redeemOpen?: {
    amount: number;
    netAmount: number;  // after advertiser subsidy
    transactionId: string;
    cardCampaignId: string;
  };
  geo: GeoLocation;
}

export interface UserCardActionPaymentInfo {
  amount: number;
  transactionId: string;
  cardCampaignId: string;
  category: CardPaymentCategory;
  weight: number;
  weightedRevenue: number;
  mobile: boolean;
}

export interface UserCardActionReportInfo {
  reasons: ReportCardReason[];
  comment: string;
  refundRequested: boolean;
  refundCompleted: boolean;
  transactionId: string;
}

export type CardPaymentCategory = "normal" | "first" | "fan" | "fraud" | "blocked" | "bonus";

export type CardActionType = "impression" | "open" | "pay" | "close" | "like" | "reset-like" | "dislike" | "redeem-promotion" | "redeem-ad-impression" | "redeem-open-payment" | "redeem-click-payment" | "make-private" | "make-public" | "click" | "report" | "comment";
export type CardPaymentFraudReason = "author-fingerprint" | "prior-payor-fingerprint";

export interface UserCardInfoRecord {
  userId: string;
  cardId: string;
  created: number;
  impressions: number;
  lastImpression: number;
  lastOpened: number;
  lastClicked: number;
  lastClosed: number;
  lastCommentsFetch: number;
  paidToAuthor: number;
  paidToReader: number;
  earnedFromAuthor: number;
  earnedFromReader: number;
  openFeeRefunded: boolean;
  transactionIds: string[];
  like: CardLikeState;
  commentNotificationPending?: boolean;
  referredPurchases: number;
}

export type CardLikeState = "none" | "like" | "dislike";

export interface BankCouponRecord {
  id: string;
  sessionId: string;
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

export type BankTransactionReason = "card-promotion" | "card-open-payment" | "card-click-payment" | "card-open-fee" | "interest" | "subsidy" | "grant" | "inviter-reward" | "invitee-reward" | "withdrawal" | "deposit" | "publisher-subsidy" | "referral-bonus" | "registration-bonus" | "paypal-payment-received" | "advertiser-subsidy" | "impression-ad" | "card-bonus";

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
  sessionId: string;
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
  baseCardPrice: number;
}

export interface NetworkCardStats {
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  paidOpens: number;
  paidUnits: number;
  likes: number;
  dislikes: number;
  reports: number;
  refunds: number;
  cardRevenue: number;
  blockedPaidOpens: number;
  firstTimePaidOpens: number;
  fanPaidOpens: number;
  grossRevenue: number;
  weightedRevenue: number;
  purchasers: number;
  registrants: number;
  publishers: number;
  purchases: number;
  cards: number;
  cardPayments: number;
  advertisers: number;
  adCardsOpenOrClick: number;
  adCardsImpression: number;
  adPaidOpenOrClicks: number;
  adPaidImpressions: number;
  adImpressionRedemptions: number;
  adOpenOrClickRedemptions: number;
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
  sessionId: string;
  state: ChannelStatus;
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
  firstCardPosted: number;
  keywords: string[];
  featuredWeight: number;
  listingWeight: number;
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
  sessionId: string;
  added: number;
  lastCardPosted: number;
  subscriptionState: ChannelSubscriptionState;
  lastUpdated: number;
  notificationPending: boolean;
  lastNotification: number;
  lastVisited: number;
}

export type ChannelSubscriptionState = "subscribed" | "unsubscribed" | "blocked" | "previously-subscribed";

export interface ChannelCardRecord {
  channelId: string;
  cardId: string;
  sessionId: string;
  state: ChannelCardState;
  cardPostedAt: number;
  added: number;
  removed: number;
  pinned: boolean;
  pinPriority: number;
}

export type ChannelCardState = "active" | "inactive";

export interface UserRegistrationRecord {
  sessionId: string;
  userId: string;
  at: number;
  ipAddress: string;
  fingerprint: string;
  isMobile: boolean;
  address: string;
  referrer: string;
  landingPage: string;
  userAgent: string;
  referringUserId: string;
}

export interface ChannelKeywordRecord {
  channelId: string;
  keyword: string;
  cardCount: number;
  lastUsed: number;
}

export interface AdSlotRecord {
  id: string;
  sessionId: string;
  userId: string;
  userBalance: number;
  channelId: string;
  cardId: string;
  cardCampaignId: string;
  created: number;
  authorId: string;
  type: AdSlotType;
  status: AdSlotStatus;
  redeemed: boolean;
  statusChanged: number;
  amount: number;
  userGeo: GeoLocation;
  geoTargets: string[];
}

export interface GeoLocation {
  fingerprint: string;
  ipAddress: string;
  continentCode: string;
  countryCode: string;
  regionCode: string;
  city: string;
  zipCode: string;
  lat: number;
  lon: number;
}

export type AdSlotType = "impression-ad" | "impression-content" | "open-payment" | "click-payment" | "announcement";

export type AdSlotStatus = "pending" | "impression" | "opened" | "open-paid" | "clicked" | "redemption-failed";

export interface CardCommentRecord {
  id: string;
  sessionId: string;
  at: number;
  cardId: string;
  byId: string;
  text: string;
  metadata: CardCommentMetadata;
  curation: CommentCurationType;
}

export interface CardCommentMetadata {
  fields: CardCommentFieldDescriptor[];
}

export interface CardCommentFieldDescriptor {
  startOffset: number;
  length: number;
  text: string;
  type: CardCommentFieldType;
  href?: string;
  handle?: string;
}

export type CardCommentFieldType = "hyperlink" | "handle";

export interface DepositRecord {
  id: string;
  sessionId: string;
  at: number;
  receivedBy: string;
  status: DepositStatus;
  fromHandle: string;
  userId: string;
  amount: number;
  currency: string;
  net: number;
  paypalReference: string;
  transactionId: string;
}

export type DepositStatus = "pending" | "completed";

export interface CardCampaignRecord {
  id: string;
  sessionId: string;
  created: number;
  createdById: string;
  status: CardCampaignStatus;
  eligibleAfter: number;
  couponId: string;
  cardIds: string[];
  type: CardCampaignType;
  paymentAmount: number;
  advertiserSubsidy: number;
  budget: CardCampaignBudget;
  ends: number;  // date
  geoTargets: string[];  // AS, NA.US, EU.UK, NA.US.CA, NA.US.94306, etc.
  stats: CardCampaignStats;
  lastStatsSnapshot: number;
}

export interface CardCampaignStats {
  impressions: number;
  opens: number;
  clicks: number;
  redemptions: number;
  expenses: number;
}

export type CardCampaignStatus = "active" | "insufficient-funds" | "expired" | "suspended" | "exhausted" | "paused";

export interface CardCampaignBudget {
  promotionTotal: number; // content-promotion only
  plusPercent: number;  // content-promotion only
  maxPerDay: number;  // ad types only
}

export type CardCampaignType = "content-promotion" | "impression-ad" | "pay-to-open" | "pay-to-click";

export interface CardCampaignStatsSnapshotRecord {
  campaignId: string;
  at: number;
  stats: CardCampaignStats;
}

export interface ShortUrlRecord {
  at: number;
  byId: string;
  sessionId: string;
  code: string;
  originalUrl: string;
}

export interface AuthorUserRecord {
  authorId: string;
  userId: string;
  stats: AuthorUserStats;
  isCurrent: boolean;
  periodStarting: number;
}

export interface AuthorUserStats {
  likes: number;
  dislikes: number;
  purchases: number;
  referredCards: number;
  referredPurchases: number;
}

export interface UserStatsRecord {
  userId: string;
  stats: UserStats;
  isCurrent: boolean;
  periodStarting: number;
}

export interface UserStats {
  cardsSold: number;
  distinctPurchasers: number;
  cardsPurchased: number;
  distinctVendors: number;
  cardsReferred: number;
  vendorsReferred: number;
  purchasesReferred: number;
  cardsLiked: number;
}

export interface PromotionGeoPricingRecord {
  geoTarget: string;
  pricing: PromotionPricingInfo;
}

export interface PromotionPricingInfo {
  contentImpression: number;
  adImpression: number;
  payToOpen: number;
  payToClick: number;
  payToOpenSubsidy: number;
  payToClickSubsidy: number;
}
