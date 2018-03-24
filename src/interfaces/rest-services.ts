
import { CardLikeState, BankTransactionReason, CardStatistics, UserRecord, SocialLink, ChannelSubscriptionState, ManualWithdrawalRecord, ManualWithdrawalState, UserCurationType, ImageInfo, ChannelStats, ChannelRecord, ChannelCardState, CardCommentMetadata, CardCommentRecord, CardRecord, CommentCurationType, DepositRecord, CardCampaignStatus, CardCampaignType, CardCampaignBudget, CardCampaignStats, BankCouponDetails, GeoLocation, CardActionType } from "./db-records";
import { SignedObject } from "./signed-object";
import { BinnedUserData, BinnedCardData, BinnedPaymentData, BinnedAdSlotData } from "../db";

export interface RestRequest<T extends Signable> {
  sessionId: string;
  version: number;
  details: string;
  detailsObject?: T;
  signature: string;
}

export interface RestResponse {
  serverVersion: number;
}

export interface RegisterUserDetails extends Signable {
  publicKey: string;
  inviteCode?: string;
  referrer: string;
  landingUrl: string;
  userAgent: string;
  landingCardId: string;
}

export interface Signable {
  address: string;
  fingerprint: string;
  timestamp: number;
}

export interface RegisterUserResponse extends RestResponseWithUserStatus {
  sessionId: string;
  id: string;
  interestRatePerMillisecond: number;
  subsidyRate: number;
  operatorTaxFraction: number;
  operatorAddress: string;
  networkDeveloperRoyaltyFraction: number;
  networkDeveloperAddress: string;
  referralFraction: number;
  withdrawalsEnabled: boolean;
  depositUrl: string;
  admin: boolean;
  promotionPricing: PromotionPricingInfo;
}

export interface PromotionPricingInfo {
  contentImpression: number;
  adImpression: number;
  payToOpen: number;
  payToClick: number;
  payToOpenSubsidy: number;
  payToClickSubsidy: number;
}

export interface SignInDetails extends Signable {
  handleOrEmailAddress: string;
}

export interface SignInResponse {
  encryptedPrivateKey: string;
}

export interface UserStatusDetails extends Signable {
  appVersion: string;
}

export interface UserStatusResponse extends RestResponseWithUserStatus { }

export interface UserStatus {
  goLive: number;
  initialBalance: number;
  userBalance: number;
  userBalanceAt: number;
  minBalanceAfterWithdrawal: number;
  timeUntilNextAllowedWithdrawal: number;
  targetBalance: number;
  cardBasePrice: number;
  totalPublisherRevenue: number;
  totalCardDeveloperRevenue: number;
  publisherSubsidies: PublisherSubsidiesInfo;
  firstCardPurchasedId: string;
  lastLanguagePublished: string;
}

export interface PublisherSubsidiesInfo {
  dayStarting: number;
  remainingToday: number;
  newUserBonus: number;
  returnUserBonus: number;
}

export interface RequestRecoveryCodeDetails {
  handle: string;
  emailAddress: string;
}

export interface RequestRecoveryCodeResponse extends RestResponse { }

export interface RecoverUserDetails extends Signable {
  code: string;
  handle: string;
  encryptedPrivateKey: string;
}

export interface RecoverUserResponse extends GetUserIdentityResponse {
  status: UserStatus;
}

export interface UpdateUserIdentityDetails extends Signable {
  name?: string;
  handle?: string;
  location?: string;
  imageId?: string;
  emailAddress?: string;
  encryptedPrivateKey?: string;
}

export interface UpdateUserIdentityResponse extends RestResponse { }

export interface GetUserIdentityDetails extends Signable { }

export interface GetUserIdentityResponse extends RestResponse {
  name: string;
  handle: string;
  location: string;
  image: FileInfo;
  emailAddress: string;
  emailConfirmed: boolean;
  encryptedPrivateKey: string;
  accountSettings: AccountSettings;
  homeChannelId: string;
}

export interface AccountSettings {
  disallowPlatformEmailAnnouncements: boolean;
  disallowContentEmailAnnouncements: boolean;
  preferredLangCodes: string[];
  disallowCommentEmailAnnouncements: boolean;
}

export interface GetHandleDetails extends CheckHandleDetails { }

export interface GetHandleResponse extends RestResponse {
  name: string;
  handle: string;
  image: FileInfo;
}

export interface CheckHandleDetails extends Signable {
  handle: string;
}

export interface CheckHandleResponse extends RestResponse {
  valid: boolean;
  inUse: boolean;
}

export interface CardState {
  properties: { [name: string]: any };
  collections: { [name: string]: CardCollection };
  files: { [fileId: string]: FileMetadata };
}

export interface FileMetadata {
  key?: string;  // optional when posting
  url?: string;  // only when CardState is returned
  image?: ImageInfo;  // only when CardState is returned and file is an image
}

export interface CardCollection {
  keyField?: string;
  records: any[];
}

export interface GetFeedsDetails extends Signable {
  feeds: RequestedFeedDescriptor[];
  startWithCardId?: string;
  existingPromotedCardIds: string[];
}

export interface RequestedFeedDescriptor {
  channelId?: string;  // if within a specific channel
  type: CardFeedType;
  channelHandle?: string;
  maxCount: number;
  afterCardId?: string;
}

export type CardFeedType = 'recommended' | 'new' | 'top-all-time' | 'top-past-week' | 'top-past-month' | 'mine' | 'opened' | 'channel' | 'subscribed';

export interface GetFeedsResponse extends RestResponse {
  feeds: CardFeedSet[];
}

export interface CardFeedSet {
  type: CardFeedType;
  channelHandle?: string;
  cards: CardDescriptor[];
  moreAvailable: boolean;
}

export interface CardDescriptor {
  id: string;
  postedAt: number;
  by: UserDescriptor;
  referredBy?: UserDescriptor;
  private: boolean;
  summary: CardSummary;

  keywords: string[];
  cardType: {
    package: string;
    iconUrl: string;
    royaltyFraction: number;
    royaltyAddress: string;
  };
  pricing: {
    promotionFee: number;
    openFee: number;  // in ChannelCoin, -ve for ads
    discountedOpenFee: number;  // 0.01 for first-time card purchase, otherwise = openFee
    openFeeUnits: number;  // 1..10 for paid content, 0 for ads
  };
  promoted: boolean;
  adSlotId: string;
  stats: CardDescriptorStatistics;
  score: number;
  userSpecific: {
    isPoster: boolean;
    lastImpression: number;
    lastOpened: number;
    lastClosed: number;
    likeState: CardLikeState;
    paidToAuthor: number;
    paidToReader: number;
    earnedFromAuthor: number;
    earnedFromReader: number;
    openFeeRefunded: boolean;
    addedToHomeChannel: boolean;
  };
  state?: {
    user: CardState;
    shared: CardState;
  };

  blocked: boolean;
  boost?: number;
  overrideReports: boolean;
  reasons: ReportCardReason[];
  sourceChannelId: string;
  commentCount: number;
  pinning?: ChannelCardPinInfo;
  campaign: CardCampaignDescriptor;
  couponId: string;
}

export interface ChannelCardPinInfo {
  pinned: boolean;
  order: number;
}

export interface CardSummary {
  imageId: string;
  imageURL: string;  // Not included when posting
  imageInfo: ImageInfo;  // Not included with posting
  linkUrl: string;  // only for ad cards
  iframeUrl: string;  // only for iframe ad cards
  title: string;
  text: string;
  langCode: string;
}

export interface CardDescriptorStatistics {
  revenue: number;
  promotionsPaid: number;
  openFeesPaid: number;
  impressions: number;
  uniqueImpressions: number;
  opens: number;
  uniqueOpens: number;
  likes: number;
  dislikes: number;
  reports: number;
  refunds: number;
  firstTimePurchases: number;
  normalPurchases: number;
}

export interface EnsureChannelComponentDetails extends Signable {
  package: string;  // appropriate to be passed to bower install <package>
}

export interface ChannelComponentResponse extends RestResponse {
  source: string;
  importHref: string;
  package: BowerInstallResult;
  channelComponent: ChannelComponentDescriptor;
  iconUrl: string;
}

export interface BowerInstallResult {
  endpoint: {
    name: string;
    source: string;
    target: string;
  };
  pkgMeta: BowerPackageMeta;
}

export interface BowerPackageMeta {
  name: string;
  homepage: string;
  version: string;
  main?: string;
  _release: string;
  _resolution: {
    type: string;
    tag: string;
    commit: string;
  };
  _source: string;
  _target: string;
}

export interface ChannelComponentDescriptor {
  composerTag: string;
  viewerTag: string;
  iconUrl: string;   // relative to channels-component.json file
  developerFraction: number;
  developerAddress: string;
}

export interface GetCardDetails extends Signable {
  cardId: string;
  channelIdContext: string;
  maxComments: number;
  includePromotedCards: boolean;
}

export interface GetCardResponse extends RestResponse {
  card: CardDescriptor;
  paymentDelayMsecs: number;
  promotedCards: CardDescriptor[];
  totalComments: number;
  comments: CardCommentDescriptor[];
  commentorInfoById: { [id: string]: CommentorInfo };
}

export interface CommentorInfo {
  name: string;
  handle: string;
  image?: FileInfo;
}

export interface CardCommentDescriptor {
  id: string;
  at: number;
  cardId: string;
  byId: string;
  text: string;
  metadata: CardCommentMetadata;
}

export interface CardStatsHistoryDetails extends Signable {
  cardId: string;
  historyLimit: number;
}

export interface CardStatsHistoryResponse extends RestResponse {
  revenue: CardStatDatapoint[];
  promotionsPaid: CardStatDatapoint[];
  openFeesPaid: CardStatDatapoint[];
  impressions: CardStatDatapoint[];
  uniqueImpressions: CardStatDatapoint[];
  opens: CardStatDatapoint[];
  uniqueOpens: CardStatDatapoint[];
  likes: CardStatDatapoint[];
  dislikes: CardStatDatapoint[];
  normalPurchases: CardStatDatapoint[];
  firstTimePurchases: CardStatDatapoint[];
}

export interface CardStatDatapoint {
  value: number;
  at: number;
}

export interface PostCardDetails extends Signable {
  imageId?: string;
  linkUrl?: string;
  iframeUrl?: string;
  title?: string;
  text: string;
  langCode: string; // IOS 639-1 code such as 'en'
  keywords: string[];
  searchText: string;
  private: boolean;
  cardType?: string;
  openFeeUnits: number;
  sharedState: CardState;
  fileIds: string[];
  coupon: SignedObject;
  campaignInfo?: CardCampaignInfo;
}

export interface PostCardResponse extends RestResponse {
  cardId: string;
  couponId?: string;
}

export interface UpdateCardStateDetails extends Signable {
  cardId: string;
  summary?: CardSummary;
  state?: CardState;
  keywords?: string[];
}

export interface UpdateCardStateResponse extends RestResponse { }

export interface UpdateCardPricingDetails extends Signable {
  cardId: string;
  openFeeUnits: number;
}

export interface CardPricingInfo {
  promotionFee?: number;
  openPayment?: number; // for ads, in ChannelCoin
  openFeeUnits?: number; // for content, 1..10
  budget?: {
    amount: number;
    plusPercent: number;
  };
  coupon?: SignedObject;   // BankCouponDetails
}

export interface UpdateCardPricingResponse extends RestResponse { }

export interface UpdateCardPrivateDetails extends Signable {
  cardId: string;
  private: boolean;
}

export interface UpdateCardPrivateResponse extends RestResponse {
  newValue: boolean;
}

export interface DeleteCardDetails extends Signable {
  cardId: string;
}

export interface DeleteCardResponse extends RestResponse { }

export interface CardImpressionDetails extends Signable {
  cardId: string;
  adSlotId: string;
  transaction: SignedObject;
}

export interface CardImpressionResponse extends RestResponseWithUserStatus {
  transactionId?: string;
}

export interface CardOpenedDetails extends Signable {
  cardId: string;
  adSlotId: string;
}

export interface CardOpenedResponse extends RestResponse { }

export interface CardClickedDetails extends Signable {
  cardId: string;
  adSlotId: string;
  transaction?: SignedObject;
}

export interface CardClickedResponse extends RestResponseWithUserStatus {
  transactionId: string;
}

export interface CardPayDetails extends Signable {
  transaction: SignedObject;
  mobile: boolean;
}

export interface CardPayResponse extends RestResponseWithUserStatus {
  transactionId: string;
  totalCardRevenue: number;
}

export interface CardRedeemOpenDetails extends Signable {
  cardId: string;
  adSlotId: string;
  transaction: SignedObject;
}

export interface CardRedeemOpenResponse extends RestResponseWithUserStatus {
  transactionId: string;
}

export interface RestResponseWithUserStatus extends RestResponse {
  status: UserStatus;
}

export interface CardClosedDetails extends Signable {
  cardId: string;
}

export interface CardClosedResponse extends RestResponse { }

export interface UpdateCardLikeDetails extends Signable {
  cardId: string;
  selection: CardLikeState;
}

export interface UpdateCardLikeResponse extends RestResponse {
  newValue: CardLikeState;
}

export interface BankWithdrawDetails extends Signable {
  transaction: SignedObject;  // signed BankTransactionDetails with type = withdrawal
}

export type Currency = "USD";

export type WithdrawalMechanism = "Paypal";

export interface BankWithdrawResponse extends RestResponseWithUserStatus {
  paidAmount: number;
  feeAmount: number;
  feeDescription: string;
  currency: Currency;
  channelsReferenceId: string;
  paypalReferenceId: string;
  updatedBalance: number;
  updateBalanceAt: number;
}

export interface BankStatementDetails extends Signable {
  maxTransactions: number;
}

export interface BankStatementResponse extends RestResponse {
  transactions: BankTransactionDetailsWithId[];
}

export interface BankTransactionDetailsWithId {
  id: string;
  deductions: number;
  remainderShares: number;
  relatedCardTitle: string;
  details: BankTransactionDetails;
  isOriginator: boolean;
  isRecipient: boolean[];
  refunded: boolean;
  description: string;
}

export interface BankTransactionDetails extends Signable {
  type: BankTransactionType;
  reason: BankTransactionReason;
  relatedCardId: string;
  relatedCardCampaignId: string;
  relatedCouponId: string;
  amount: number;  // ChannelCoin
  toRecipients: BankTransactionRecipientDirective[];
  withdrawalRecipient?: BankWithdrawalRecipient;
}

export type BankTransactionType = "transfer" | "coupon-redemption" | "withdrawal" | "deposit";  // others to come such as "coupon-create"

export interface BankWithdrawalRecipient {
  mechanism: WithdrawalMechanism;
  currency: Currency;
  recipientContact: string;  // email, mobile number, or paypal.me link
}

export interface BankTransactionRecipientDirective {
  address: string;
  portion: BankTransactionRecipientPortion;
  amount?: number;  // ChannelCoin or fraction (0 to 1) depending on portion
  reason: BankTransactionRecipientReason;
}

export type BankTransactionRecipientReason = "content-purchase" | "card-developer-royalty" | "referral-fee" | "coupon-redemption" | "network-operations" | "network-creator-royalty" | "grant-recipient" | "depositor" | "invitation-reward-recipient" | "interest-recipient" | "subsidy-recipient" | "publisher-subsidy-recipient" | "referral-bonus" | "registration-bonus" | "advertiser-subsidy";

export type BankTransactionRecipientPortion = "remainder" | "fraction" | "absolute";

export interface BankCouponRequestDetails extends Signable {
  coupon: SignedObject;  // BankCouponDetails
}

export interface BankGenerateClientTokenDetails extends Signable { }

export interface BankGenerateClientTokenResponse extends RestResponse {
  clientToken: string;
}

export interface SearchDetails extends Signable {
  searchString: string;
  limitCards: number;
  limitChannels: number;
}

export interface SearchResponse extends RestResponse {
  cardResults: SearchCardResults;
  channelResults: SearchChannelResults;
}

export interface SearchMoreCardsDetails extends Signable {
  searchString: string;
  skip: number;
  limit: number;
}

export interface SearchMoreCardsResponse extends RestResponse {
  cardResults: SearchCardResults;
}

export interface SearchMoreChannelsDetails extends Signable {
  searchString: string;
  skip: number;
  limit: number;
}

export interface SearchMoreChannelsResponse extends RestResponse {
  channelResults: SearchChannelResults;
}

export interface SearchCardResults {
  cards: CardDescriptor[];
  moreAvailable: boolean;
  nextSkip: number;
}

export interface SearchChannelResults {
  channels: ChannelDescriptor[];
  moreAvailable: boolean;
  nextSkip: number;
}

export interface DiscardFilesDetails extends Signable {
  fileIds: string[];
}

export interface DiscardFilesResponse extends RestResponse { }

export interface AdminGetUsersDetails extends Signable {
  limit: number;
  withIdentityOnly: boolean;
}

export interface AdminGetUsersResponse extends RestResponse {
  users: AdminUserInfo[];
}

export interface AdminGetCardsDetails extends Signable {
  limit: number;
}

export interface AdminGetCardsResponse extends RestResponse {
  cards: AdminCardInfo[];
}

export interface AdminGetChannelsDetails extends Signable { }

export interface AdminGetChannelsResponse extends RestResponse {
  channels: AdminChannelInfo[];
}

export interface AdminGetCommentsDetails extends Signable { }

export interface AdminGetCommentsResponse extends RestResponse {
  comments: AdminCommentInfo[];
}

export interface AdminCommentInfo {
  comment: CardCommentRecord;
  by: UserRecord;
  card: CardRecord;
}

export interface AdminChannelInfo {
  channel: ChannelRecord;
  descriptor: ChannelDescriptor;
  owner: UserRecord;
  referralBonuses: number;
}

export interface AdminCardInfo {
  descriptor: CardDescriptor;
  scoring: {
    age: number;
    opens: number;
    likes: number;
    boost: number;
    total: number;
  };
}

export interface AdminUserInfo {
  user: UserRecord;
  cardsPosted: number;
  privateCards: number;
  cardRevenue: number;
  cardsOpened: number;
  cardsBought: number;
  cardsSold: number;
  cardsDeleted: number;
}

export interface AdminGetGoalsDetails extends Signable { }

export interface AdminGetGoalsResponse extends RestResponse {
  users: AdminUserStats;
  activeUsers: AdminActiveUserStats;
  cards: AdminCardStats;
  purchases: AdminPurchaseStats;
  ads: AdminAdStats;
  subscriptions: AdminSubscriptionStats;

  // cards: {
  //   total: number;
  //   recent: RecentStats;
  //   revenue: number;
  //   refunds: number;
  //   authors: number;
  // };
  // purchases: {
  //   total: number;
  //   recent: RecentStats;
  //   firstTime: RecentStats;
  //   revenue: number;
  //   weightedRevenue: number;
  //   recentRevenue: RecentStats;
  //   purchasers: RecentStats;
  //   sellers: RecentStats;
  // };
  // ads: {
  //   total: number;
  //   recent: RecentStats;
  //   revenue: number;
  //   recentRevenue: RecentStats;
  //   consumers: RecentStats;
  //   advertisers: RecentStats;
  // };
}

export interface AdminUserStats {
  total: number;
  newUsers: RecentStats;
  totalWithIdentity: number;
  totalStaleWithIdentity: number;
  newUsersWithIdentity: RecentStats;
  excessBalance: number;
}

export interface AdminActiveUserStats {
  total: RecentStats;
  withIdentity: RecentStats;
  returning: RecentStats;
  returningWithIdentity: RecentStats;
}

export interface AdminCardStats {
  total: number;
  newCards: RecentStats;
  budget: number;
  spent: number;
  revenue: number;
}

export interface AdminPurchaseStats {
  total: number;
  totalRevenue: number;
  totalFirstTime: number;
  totalFraud: number;
  newPurchases: RecentStats;
  newRevenue: RecentStats;
  newWeightedRevenue: RecentStats;
  newFirstTime: RecentStats;
  fraud: RecentStats;
  purchasers: RecentStats;
  sellers: RecentStats;
}

export interface AdminAdStats {
  total: number;
  revenue: number;
  newSlots: RecentStats;
  newRevenue: RecentStats;
  consumers: RecentStats;
  advertisers: RecentStats;
}

export interface AdminSubscriptionStats {
  totalSubscribers: number;
  totalSubscriptions: number;
  totalChannelsWithSubscriptions: number;
  totalSubscriptionBonuses: number;
  totalFraud: number;
  newSubscriptions: RecentStats;
  newSubscriptionBonuses: RecentStats;
  newFraud: RecentStats;
}

export interface RecentStats {
  today: number;
  yesterday: number;
  priorWeek: number;
  priorMonth: number;
}

export interface AdminGoalsInfo {
  dayStarting: number;
  users: AdminUserGoalsInfo;
  publishers: AdminPublisherGoalsInfo;
  cards: AdminCardGoalsInfo;
  publisherRevenue: AdminPublisherRevenueGoalsInfo;
  adRevenue: AdminAdRevenueGoalsInfo;
}

export interface AdminUserGoalsInfo {
  total: number;
  totalWithIdentity: number;
  newUsers: number;
  newUsersWithIdentity: number;
  activeUsers: number;
  activeUsersWithIdentity: number;
  returningUsers: number;
  returningUsersWithIdentity: number;
}

export interface AdminPublisherGoalsInfo {
  total: number;
  newPublishers: number;
  posted: number;
}

export interface AdminCardGoalsInfo {
  total: number;
  totalNonPromoted: number;
  totalPromoted: number;
  totalAds: number;
  totalPaidOpens: number;
  totalFirstTimePaidOpens: number;
  totalNormalPaidOpens: number;
  totalFanPaidOpens: number;
  totalGrossRevenue: number;
  totalWeightedRevenue: number;
  newCards: number;
  newNonPromoted: number;
  newPromoted: number;
  newAds: number;
  newPaidOpens: number;
  newFirstTimePaidOpens: number;
  newNormalPaidOpens: number;
  newFanPaidOpens: number;
  newGrossRevenue: number;
  newWeightedRevenue: number;
}

export interface AdminPublisherRevenueGoalsInfo {
  totalCardsOpened: number;
  totalCardsPurchased: number;
  totalCardsFullPrice: number;
  totalCardsDiscounted: number;
  totalRevenue: string;
  newCardsOpened: number;
  newCardsPurchased: number;
  newCardsFullPrice: number;
  newCardsDiscounted: number;
  newRevenue: string;
}

export interface AdminAdRevenueGoalsInfo {
  totalImpressions: number;
  totalPromotedOpens: number;
  totalPromotedRevenue: string;
  totalAdRevenue: string;
  totalClickRevenue: string;
  newImpressions: number;
  newPromotedOpens: number;
  newPromotedRevenue: string;
  newAdRevenue: string;
  newClickRevenue: string;
}

export interface AdminGetPublishersDetails extends Signable { }

export interface AdminGetPublishersResponse extends RestResponse {
  publishers: AdminPublisherInfo[];
}

export interface AdminPublisherInfo {
  user: UserRecord;
  cardsPublished: number;
  earnings: number;
  grossRevenue: number;
  weightedRevenue: number;
  recentRevenue: number;
  subscribers: number;
  cardsPurchased: number;
  recentPurchases: number;
  fraudPurchases: number;
  firstTimePurchases: number;
  normalPurchases: number;
  fanPurchases: number;
  otherPurchases: number;
}

export interface AdminSetUserMailingListDetails extends Signable {
  userId: string;
  mailingList: boolean;
}

export interface AdminSetUserMailingListResponse extends RestResponse { }

export interface AdminUpdateCardDetails extends Signable {
  cardId: string;
  keywords: string[];
  blocked: boolean;
  boost: number;
  overrideReports: boolean;
}

export interface AdminUpdateCardResponse extends RestResponse { }

export interface AdminUpdateChannelDetails extends Signable {
  channelId: string;
  featuredWeight: number;
  listingWeight: number;
}

export interface AdminUpdateChannelResponse extends RestResponse { }

export interface AdminGetWithdrawalsDetails extends Signable {
  limit: number;
}

export interface AdminGetWithdrawalsResponse extends RestResponse {
  withdrawals: ManualWithdrawalInfo[];
}

export interface ManualWithdrawalInfo {
  record: ManualWithdrawalRecord;
  user: {
    id: string;
    handle: string;
    email: string;
    name: string;
    balance: number;
  };
  lastUpdatedByName: string;
}

export interface AdminUpdateWithdrawalDetails extends Signable {
  id: string;
  state: ManualWithdrawalState;
  paymentReferenceId: string;
}

export interface AdminUpdateWithdrawalResponse extends RestResponse { }
export interface AdminSetUserCurationDetails extends Signable {
  userId: string;
  curation: UserCurationType;
}

export interface AdminSetUserCurationResponse extends RestResponse { }

export interface AdminSetCommentCurationDetails extends Signable {
  commentId: string;
  curation: CommentCurationType;
}

export interface AdminSetCommentCurationResponse extends RestResponse { }

export interface QueryPageDetails extends Signable {
  url: string;
}

export interface QueryPageResponse extends RestResponse {
  embeddable: boolean;
  notEmbeddableReason?: string;
}

export interface SearchTopicDetails extends Signable {
  topic: string;
  maxCount: number;
  afterCardId?: string;
  promotedCardIds: string[];
}

export interface SearchTopicResponse extends RestResponse {
  cards: CardDescriptor[];
  moreAvailable: boolean;
}

export interface ListTopicsDetails extends Signable { }

export interface ListTopicsResponse extends RestResponse {
  topics: string[];
}

export interface GetChannelDetails extends Signable {
  channelId: string;  // you must provide either channelId, ownerId or handle
  ownerId: string;
  ownerHandle: string;
  channelHandle: string;
}

export interface GetChannelResponse extends RestResponse {
  channel: ChannelDescriptor;
}

export interface ChannelDescriptorWithCards {
  channel: ChannelDescriptor;
  cards: CardDescriptor[];
}

export interface ChannelDescriptor {
  id: string;
  name: string;
  handle: string;
  bannerImage: FileInfo;
  owner: UserDescriptor;
  created: number;
  about: string;
  linkUrl: string;
  socialLinks: SocialLink[];
  stats: ChannelStats;
  subscriptionState: ChannelSubscriptionState;
}

export interface UserDescriptor {
  id: string;
  address: string;
  handle: string;
  publicKey?: string;
  name: string;
  image: FileInfo;
  location: string;
}

export interface FileInfo {
  id: string;
  url: string;
  imageInfo: ImageInfo;
}

export interface GetChannelsDetails extends Signable {
  type: ChannelFeedType;
  maxChannels: number;
  maxCardsPerChannel: number;
  nextPageReference?: string;   // if provided, used to get next page based on GetChannelsResponse.nextPageReference
}

export type ChannelFeedType = "recommended" | "new" | "subscribed" | "blocked";

export interface GetChannelsResponse extends RestResponse {
  channels: ChannelDescriptor[];
  nextPageReference: string;  // If not-null, more is available; use this in next call
}

export interface UpdateChannelDetails extends Signable {
  channelId: string;
  name?: string;
  bannerImageFileId?: string;
  about?: string;
  link?: string;
  socialLinks?: SocialLink[];
}

export interface UpdateChannelResponse extends RestResponse { }

export interface UpdateChannelSubscriptionDetails extends Signable {
  channelId: string;
  subscriptionState: ChannelSubscriptionState;
}

export interface UpdateChannelSubscriptionResponse extends RestResponse { }

export interface ReportChannelVisitDetails extends Signable {
  channelId: string;
}

export interface ReportChannelVisitResponse extends RestResponse { }

export interface RequestEmailConfirmationDetails extends Signable { }

export interface RequestEmailConfirmationResponse extends RestResponse { }

export interface ConfirmEmailDetails extends Signable {
  code: string;
}

export interface ConfirmEmailResponse extends RestResponseWithUserStatus {
  userId: string;
  handle: string;
}

export interface UpdateAccountSettingsDetails extends Signable {
  settings: AccountSettings;
}

export interface UpdateAccountSettingsResponse extends GetUserIdentityResponse { }

export interface ReportCardDetails extends Signable {
  cardId: string;
  reasons: ReportCardReason[];
  comment: string;
  requestRefund: boolean;
  adminBlockCard: boolean;
  adminBlockUser: boolean;
}

export type ReportCardReason = "inappropriate" | "plagiarism" | "clickbait" | "junk" | "other";

export interface ReportCardResponse extends RestResponseWithUserStatus { }

export interface GetHomePageDetails extends Signable {
  maxSubscribedCards: number;
  maxCardsPerChannel: number;
}

export interface GetHomePageResponse extends RestResponse {
  featuredChannels: ChannelDescriptor[];
  subscribedContent: CardDescriptor[];
  channels: ChannelInfoWithCards[];
  promotedContent: CardDescriptor[];
  newContent: CardDescriptor[];
}

export interface ChannelInfoWithCards {
  channel: ChannelDescriptor;
  cards: CardDescriptor[];
}

export interface GetChannelCardDetails extends Signable {
  channelId: string;
  cardId: string;
}

export interface GetChannelCardResponse extends RestResponse {
  info: ChannelCardInfo;
}

export interface ChannelCardInfo {
  channelId: string;
  cardId: string;
  state: ChannelCardState;
  cardPostedAt: number;
  added: number;
  removed: number;
}

export interface UpdateChannelCardDetails extends Signable {
  channelId: string;
  cardId: string;
  includeInChannel: boolean;
}

export interface UpdateChannelCardResponse extends RestResponse { }

export interface PostCardCommentDetails extends Signable {
  cardId: string;
  text: string;
  metadata: CardCommentMetadata;
}

export interface PostCardCommentResponse extends RestResponse {
  commentId: string;
}

export interface GetCardCommentsDetails extends Signable {
  cardId: string;
  before: number;  // timestmap or 0 for all
  maxCount: number;
}

export interface GetCardCommentsResponse extends RestResponse {
  comments: CardCommentDescriptor[];
  commentorInfoById: { [id: string]: CommentorInfo };
  moreAvailable: boolean;
}

export interface SetChannelCardPinningDetails extends Signable {
  channelId: string;
  cardId: string;
  pinned: boolean;
}

export interface SetChannelCardPinningResponse extends RestResponse { }

export interface AdminGetRealtimeStatsDetails extends Signable { }

export interface AdminGetRealtimeStatsResponse extends RestResponse {
  at: number;
  total: RealtimeStats;
  past24Hours: RealtimeStats;
}

export interface RealtimeStats {
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
  adOpenOrClickRedemptions: number;
  adImpressionRedemptions: number;
}

export interface AdminBankDepositDetails extends Signable {
  fromHandle: string;
  amount: number;
  currency: string;
  net: number;
  paypalReference: string;
}

export interface AdminBankDepositResponse extends RestResponse {
  transactionId: string;
}

export interface AdminGetDepositsDetails extends Signable { }

export interface AdminGetDepositsResponse extends RestResponse {
  deposits: AdminDepositInfo[];
}

export interface AdminDepositInfo {
  deposit: DepositRecord;
  depositor: UserRecord;
}

export interface GetChannelSubscribersDetails extends Signable {
  channelId: string;
  maxCount: number;
  afterSubscriberId: string;
}

export interface GetChannelSubscribersResponse extends RestResponse {
  subscribers: ChannelSubscriberInfo[];
  moreAvailable: boolean;
}

export interface ChannelSubscriberInfo {
  user: UserDescriptor;
  homeChannel: ChannelDescriptor;
}

export interface GetCardCampaignsDetails extends Signable {
  afterCampaignId: string;
  maxCount: number;
}

export interface GetCardCampaignsResponse extends RestResponse {
  campaigns: CardCampaignDescriptor[];
  moreAvailable: boolean;
}

export interface CardCampaignDescriptor {
  id: string;
  created: number;
  status: CardCampaignStatus;
  type: CardCampaignType;
  paymentAmount: number;
  advertiserSubsidy: number;
  couponId: string;
  budget: CardCampaignBudget;
  ends: number;
  geoTargets: GeoTargetDescriptor[];
  statsTotal: CardCampaignStats;
  statsLast24Hours: CardCampaignStats;
  statsLast7Days: CardCampaignStats;
  statsLast30Days: CardCampaignStats;
}

export interface GeoTargetDescriptor {
  continentCode: string;
  continentName: string;
  countryCode?: string;
  countryName?: string;
  regionCode?: string;
  regionName?: string;
  zipCode?: string;
}

export interface UpdateCardCampaignDetails extends Signable {
  campaignId: string;
  info: CardCampaignInfo;
}

export interface CardCampaignInfo {
  type: CardCampaignType;
  budget: CardCampaignBudget;
  ends: number;
  geoTargets: string[];
}

export interface UpdateCardCampaignResponse extends RestResponse { }

export interface GetGeoDescriptorsDetails extends Signable {
  countryCode?: string;
}

export interface GetGeoDescriptorsResponse extends RestResponse {
  continents: CodeAndName[];  // only if countryCode omitted
  countriesByContinent: { [continentCode: string]: CodeAndName[] }; // only if countryCode omitted
  regionsByCountry: { [countryCode: string]: CodeAndName[] };  // only if countryCode provided
}

export interface CodeAndName {
  code: string;
  name: string;
}

export interface GetAvailableAdSlotsDetails extends Signable {
  geoTargets: string[];
}

export interface GetAvailableAdSlotsResponse extends RestResponse {
  pastWeek: number;
}

export interface GetUserCardAnalyticsDetails extends Signable {
  cardId: string;
  after: number;
  maxCount: number;
}

export interface GetUserCardAnalyticsResponse extends RestResponse {
  actions: UserCardActionDescriptor[];
}

export interface UserCardActionDescriptor {
  cardId: string;
  at: number;
  geo?: {
    lat: number;
    lon: number;
    countryCode: string;
    regionCode: string;
    city: string;
  };
  action: CardActionType;
}

export interface ShortenUrlDetails extends Signable {
  url: string;
}

export interface ShortenUrlResponse extends RestResponse {
  shortUrl: string;
}
