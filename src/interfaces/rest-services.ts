
export interface RestRequest<T> {
  version: string;
  details: T;
  signature: string;
}

export interface RestResponse {
  success: boolean;
  errorMessage?: string;
}

export interface RegisterUserDetails extends Signable {
  publicKey: string;
  inviteCode?: string;
}

export interface Signable {
  address: string;
  timestamp: number;
}

export interface RegisterUserResponse extends RequestStatusResponse { }

export interface RequestStatusDetails extends Signable { }

export interface RequestStatusResponse extends RestResponse {
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

export interface RequestRegisterIosDeviceDetails extends Signable {
  deviceToken: string;
}

export interface RegisterIosDeviceResponse extends RestResponse { }
