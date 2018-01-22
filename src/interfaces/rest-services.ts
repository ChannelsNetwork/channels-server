
import { NewsItemRecord, DeviceTokenRecord, DeviceType, CardLikeState, BankTransactionReason, CardStatistics, UserRecord, ManualWithdrawalRecord, ManualWithdrawalState, UserCurationType } from "./db-records";
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
  imageUrl?: string;
  emailAddress?: string;
  encryptedPrivateKey?: string;
}

export interface UpdateUserIdentityResponse extends RestResponse { }

export interface GetUserIdentityDetails extends Signable { }

export interface GetUserIdentityResponse extends RestResponse {
  name: string;
  handle: string;
  location: string;
  imageUrl: string;
  emailAddress: string;
  encryptedPrivateKey: string;
}

export interface GetHandleDetails extends CheckHandleDetails { }

export interface GetHandleResponse extends RestResponse {
  name: string;
  handle: string;
  imageUrl: string;
}

export interface CheckHandleDetails extends Signable {
  handle: string;
}

export interface CheckHandleResponse extends RestResponse {
  valid: boolean;
  inUse: boolean;
}

export interface CardState {
  mutationId?: string;
  properties: { [name: string]: any };
  collections: { [name: string]: CardCollection };
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
  type: CardFeedType;
  channelHandle?: string;
  maxCount: number;
  afterCardId?: string;
}

export type CardFeedType = 'recommended' | 'new' | 'top' | 'mine' | 'opened' | 'channel';

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
  by: {
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
    isFollowing: boolean;
    isBlocked: boolean;
  };
  referredBy?: {
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
  };
  private: boolean;
  summary: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    linkUrl: string;
    title: string;
    text: string;
  };
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
  };
  state?: {
    user: CardState;
    shared: CardState;
  };

  blocked: boolean;
  boost?: number;
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
}

export interface GetCardResponse extends RestResponse {
  card: CardDescriptor;
  paymentDelayMsecs: number;
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
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  linkUrl?: string;
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
  summary?: {
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    linkUrl: string;
    title: string;
    text: string;
  };
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
  transaction: SignedObject;
}

export interface CardImpressionResponse extends RestResponseWithUserStatus {
  transactionId?: string;
}

export interface CardOpenedDetails extends Signable {
  cardId: string;
}

export interface CardOpenedResponse extends RestResponse { }

export interface CardClickedDetails extends Signable {
  cardId: string;
}

export interface CardClickedResponse extends RestResponse { }

export interface CardPayDetails extends Signable {
  transaction: SignedObject;
}

export interface CardPayResponse extends RestResponseWithUserStatus {
  transactionId: string;
  totalCardRevenue: number;
}

export interface CardRedeemOpenDetails extends Signable {
  cardId: string;
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

export interface BankClientCheckoutDetails extends Signable {
  amount: number;
  paymentMethodNonce: string;
}

export interface BankClientCheckoutResponse extends RestResponseWithUserStatus {
  transactionResult: BraintreeTransactionResult;
}

export interface BraintreeTransactionResult {
  params: any;
  success: boolean;
  errors: BraintreeTransactionError[];
  transaction: {
    id: string;
    amount: string;
    createdAt: string;
    creditCard: {
      token: string;
      bin: string;
      last4: string;
      cardType: string;
      expirationDate: string;
      expirationMonth: string;
      expirationYear: string;
      imageUrl: string;
      maskedNumber: string;
    };
    currencyIsoCode: string;  // "USD"
    cvvResponseCode: string;
    merchantAccountId: string;
    paymentInstrumentType: string;
    processorAuthorizationCode: string;
    processorResponseCode: string;
    processorResponseText: string;
    processorSettlementResponseCode: string;
    processorSettlementResponseText: string;
    status: string;
    statusHistory: BraintreeTransactionStatusItem[];
    updatedAt: string;
  };
}

export interface BraintreeTransactionStatusItem {
  timestamp: string;
  status: string;
  amount: string;
  user: string;
  transactionSource: string;
}

export interface BraintreeTransactionError {
  attribute: string;
  code: string;
  message: string;
}

export interface SearchDetails extends Signable {
  searchString: string;
  skip: number;
  limit: number;
  existingPromotedCardIds: string[];
}

export interface SearchResponse extends RestResponse {
  cards: CardDescriptor[];
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
  newCards: number;
  newNonPromoted: number;
  newPromoted: number;
  newAds: number;
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
  newImpressions: number;
  newPromotedOpens: number;
  newPromotedRevenue: string;
  newAdRevenue: string;
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
