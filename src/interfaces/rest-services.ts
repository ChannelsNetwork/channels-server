
export interface RestRequest<T extends Signable> {
  version: number;
  details: T;
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
}

export interface UpdateUserIdentityResponse extends RestResponse { }

export interface CheckHandleDetails extends Signable {
  handle: string;
}

export interface CheckHandleResponse extends RestResponse {
  valid: boolean;
  inUse: boolean;
}

export interface PostCardDetails extends Signable {
  text: string;
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
  };
  text: string;
}
