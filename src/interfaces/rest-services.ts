
import { NewsItemRecord, DeviceTokenRecord, DeviceType, CardLikeState } from "./db-records";

export interface RestRequest<T extends Signable> {
  version: number;
  details: string;
  detailsObject?: T;
  signature: string;
}

export interface RestResponse { }

export interface RegisterUserDetails extends Signable {
  publicKey: string;
  inviteCode?: string;
  appVersion: string;
}

export interface Signable {
  address: string;
  timestamp: number;
}

export interface RegisterUserResponse extends UserStatusResponse { }

export interface UserStatusDetails extends Signable {
  appVersion: string;
}

export interface UserStatusResponse extends RestResponse {
  status: UserStatus;
  appUpdateUrl: string;
  socketUrl: string;
  interestRatePerMillisecond: number;
  cardBasePrice: number;
  subsidyRate: number;
}

export interface UserStatus {
  goLive: number;
  userBalance: number;
  inviteCode: string;
  invitationsUsed: number;
  invitationsRemaining: number;
}

export interface RegisterDeviceDetails extends Signable {
  type: DeviceType;
  token: string;
}

export interface RegisterDeviceResponse extends RestResponse { }

export interface GetSyncCodeDetails extends Signable { }

export interface GetSyncCodeResponse extends RestResponse {
  syncCode: string;
}

export interface SyncIdentityDetails extends Signable {
  handle: string;
  syncCode: string;
}

export interface SyncIdentityResponse extends UserStatusResponse { }

export interface UpdateUserIdentityDetails extends Signable {
  name?: string;
  handle?: string;
  location?: string;
  imageUrl?: string;
  emailAddress?: string;
}

export interface UpdateUserIdentityResponse extends RestResponse { }

export interface GetUserIdentityDetails extends Signable { }

export interface GetUserIdentityResponse extends RestResponse {
  name: string;
  handle: string;
  location: string;
  imageUrl: string;
  emailAddress: string;
  settings: UserSettings;
}

export interface UserSettings {
  displayNetworkBalance: boolean;
}

export interface CheckHandleDetails extends Signable {
  handle: string;
}

export interface CheckHandleResponse extends RestResponse {
  valid: boolean;
  inUse: boolean;
}

export interface CardState {
  mutationId: string;
  properties: { [name: string]: any };
  collections: { [name: string]: { [key: string]: any } };
}

export interface PostCardResponse extends RestResponse {
  cardId: string;
}

export interface GetFeedDetails extends Signable {
  feeds: RequestedFeedDescriptor[];
}

export interface RequestedFeedDescriptor {
  type: CardFeedType;
  maxCount: number;
}

export type CardFeedType = 'recommended' | 'recently_added' | 'recently_posted' | 'recently_opened';

export interface GetFeedResponse extends RestResponse {
  feeds: CardFeedSet[];
}

export interface CardFeedSet {
  type: CardFeedType;
  cards: CardDescriptor[];
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
  summary: {
    imageUrl: string;
    linkUrl: string;
    title: string;
    text: string;
  };
  cardType: {
    package: string;
    iconUrl: string;
  };
  pricing: {
    promotionFee: number;
    openFee: number;  // in ChannelCoin, -ve for ads
    openFeeUnits: number;  // 1..10 for paid content, 0 for ads
  };
  history: {
    revenue: number;
    impressions: number;
    opens: number;
    likes: number;
    dislikes: number;
  };
  score: number;
  userSpecific: {
    isPoster: boolean;
    lastImpression: number;
    lastOpened: number;
    lastClosed: number;
    likeState: CardLikeState;
    paid: number;
  };
  state?: {
    user: CardState;
    shared: CardState;
  };
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
}

export interface GetCardDetails extends Signable {
  cardId: string;
}

export interface GetCardResponse extends RestResponse {
  card: CardDescriptor;
}

export interface PostCardDetails extends Signable {
  imageUrl?: string;
  linkUrl?: string;
  title?: string;
  text: string;
  cardType?: string;
  cardTypeIconUrl?: string;
  promotionFee: number;
  openPayment?: number; // for ads, in ChannelCoin
  openFeeUnits?: number; // for content, 1..10
  state: {
    user: CardState;
    shared: CardState;
  };
}

export interface PostCardResponse extends RestResponse {
  cardId: string;
}

export interface CardImpressionDetails extends Signable {
  cardId: string;
}

export interface CardImpressionResponse extends RestResponse { }

export interface CardOpenedDetails extends Signable {
  cardId: string;
}

export interface CardOpenedResponse extends RestResponse { }

export interface CardPayDetails extends Signable {
  transactionString: string;
  transactionSignature: string;
}

export interface CardPayResponse extends RestResponse {
  transactionId: string;
  updatedBalance: number;
  balanceAt: number;
}

export interface CardClosedDetails extends Signable {
  cardId: string;
}

export interface CardClosedResponse extends RestResponse { }

export interface UpdateCardLikeDetails extends Signable {
  cardId: string;
  selection: CardLikeState;
}

export interface UpdateCardLikeResponse extends RestResponse { }

export interface BankWithdrawDetails extends Signable {
}

export interface BankWithdrawResponse extends RestResponse { }

export interface BankStatementDetails extends Signable {
}

export interface BankStatementResponse extends RestResponse { }
