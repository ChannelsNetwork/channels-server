
import { NewsItemRecord, DeviceTokenRecord, DeviceType } from "./db-records";

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
}

export interface UserStatus {
  goLive: number;
  userBalance: number;
  networkBalance: number;
  inviteCode: string;
  invitationsUsed: number;
  invitationsRemaining: number;
  inviterRewards: number;
  inviteeReward: number;
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

export interface PostCardDetails extends Signable {
  imageUrl: string;
  linkUrl: string;
  title: string;
  text: string;
  cardType: string;
  state: {
    user: CardState;
    shared: CardState;
  };
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
  beforeCardId?: string;
  afterCardId?: string;
  maxCount: number;
}

export interface GetFeedResponse extends RestResponse {
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
    project: string;
    iconUrl: string;
  };
  pricing: {
    promotionFee: number;
    openFee: number;  // in ChannelCoin, -ve for ads
    openFeeUnits: number;  // 1..10 for paid content, 0 for ads
  };
  history: {
    revenue: number;
    likes: number;
    dislikes: number;
    opens: number;
    impressions: number;
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
