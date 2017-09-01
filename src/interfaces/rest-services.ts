
import { NewsItemRecord } from "./db-records";

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
}

export interface Signable {
  address: string;
  timestamp: number;
}

export interface RegisterUserResponse extends UserStatusResponse { }

export interface UserStatusDetails extends Signable { }

export interface UserStatusResponse extends RestResponse {
  status: UserStatus;
  socketUrl: string;
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

export interface RegisterIosDeviceDetails extends Signable {
  deviceToken: string;
}

export interface RegisterIosDeviceResponse extends RestResponse { }

export interface UpdateUserIdentityDetails extends Signable {
  name: string;
  handle: string;
  location: string;
  imageUrl: string;
}

export interface UpdateUserIdentityResponse extends RestResponse { }

export interface GetUserIdentityDetails extends Signable { }

export interface GetUserIdentityResponse extends RestResponse {
  name: string;
  handle: string;
  location: string;
  imageUrl: string;
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
  at: number;
  by: {
    address: string;
    handle: string;
    name: string;
    imageUrl: string;
  };
  imageUrl: string;
  linkUrl: string;
  title: string;
  text: string;
  cardType: string;
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
