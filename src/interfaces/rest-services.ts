
import { NewsItemRecord, DeviceTokenRecord, DeviceType, CardLikeState, BankTransactionReason, CardStatistics } from "./db-records";
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
  appVersion: string;
}

export interface Signable {
  address: string;
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
}

export interface RegisterDeviceDetails extends Signable {
  type: DeviceType;
  token: string;
}

export interface RegisterDeviceResponse extends RestResponse { }

export interface SignInDetails {
  handle: string;
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
  remainingToday: number;
  perOpen: number;
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

export interface GetNewsDetails extends Signable {
  maxCount: number;
}

export interface GetNewsResponse extends RestResponse {
  items: NewsItem[];
}

export interface NewsItem {
  id: string;
  timestamp: number;
  title: string;
  text: string;
  imageUrl: string;
  linkUrl: string;
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
