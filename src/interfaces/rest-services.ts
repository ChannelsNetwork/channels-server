
import { CardLikeState, BankTransactionReason, CardStatistics, UserRecord, SocialLink, ChannelSubscriptionState, ManualWithdrawalRecord, ManualWithdrawalState, UserCurationType, ImageInfo, ChannelStats } from "./db-records";
import { SignedObject } from "./signed-object";

export interface RestRequest<T extends Signable> {
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
}

export interface Signable {
  address: string;
  fingerprint: string;
  timestamp: number;
}

export interface RegisterUserResponse extends RestResponseWithUserStatus {
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
  userBalance: number;
  userBalanceAt: number;
  minBalanceAfterWithdrawal: number;
  timeUntilNextAllowedWithdrawal: number;
  targetBalance: number;
  inviteCode: string;
  invitationsUsed: number;
  invitationsRemaining: number;
  cardBasePrice: number;
  totalPublisherRevenue: number;
  totalCardDeveloperRevenue: number;
  publisherSubsidies: PublisherSubsidiesInfo;
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
}

export interface AccountSettings {
  disallowPlatformEmailAnnouncements: boolean;
  disallowContentEmailAnnouncements: boolean;
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

export type CardFeedType = 'recommended' | 'new' | 'top' | 'mine' | 'opened' | 'channel' | 'subscribed';

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
    openFeeUnits: number;  // 1..10 for paid content, 0 for ads
  };
  promoted: boolean;
  adSlotId: string;
  couponId: string;
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
}

export interface CardSummary {
  imageId: string;
  imageURL: string;  // Not included when posting
  imageInfo: ImageInfo;  // Not included with posting
  linkUrl: string;  // only for ad cards
  iframeUrl: string;  // only for iframe ad cards
  title: string;
  text: string;
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
  includePromotedCard: boolean;
  channelIdContext: string;
}

export interface GetCardResponse extends RestResponse {
  card: CardDescriptor;
  paymentDelayMsecs: number;
  promotedCard?: CardDescriptor;
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
  keywords: string[];
  searchText: string;
  private: boolean;
  cardType?: string;
  pricing: CardPricingInfo;
  sharedState: CardState;
  fileIds: string[];
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
  pricing: CardPricingInfo;
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
}

export interface BankTransactionDetails extends Signable {
  type: BankTransactionType;
  reason: BankTransactionReason;
  relatedCardId: string;
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

export type BankTransactionRecipientReason = "content-purchase" | "card-developer-royalty" | "referral-fee" | "coupon-redemption" | "network-operations" | "network-creator-royalty" | "grant-recipient" | "depositor" | "invitation-reward-recipient" | "interest-recipient" | "subsidy-recipient" | "publisher-subsidy-recipient";

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
}

export interface AdminGetGoalsDetails extends Signable { }

export interface AdminGetGoalsResponse extends RestResponse {
  days: AdminGoalsInfo[];
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
  subscribers: number;
  cardsPurchased: number;
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

export interface ConfirmEmailResponse extends RestResponse {
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
}

export interface ChannelInfoWithCards {
  channel: ChannelDescriptor;
  cards: CardDescriptor[];
}
