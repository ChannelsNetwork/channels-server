
export interface UserRecord {
  address: string;
  publicKey: string;
  added: number;
  inviteeCode: string;
  inviterCode: string;
  balance: number;
  inviteeReward: number;
  inviterRewards: number;
  invitationsRemaining: number;
  invitationsAccepted: number;
  iosDeviceTokens: string[];
  lastContact: number;
  identity?: UserIdentity;
}

export interface UserIdentity {
  name: string;
  handle: string;
}

export interface NetworkRecord {
  id: string;
  created: number;
  balance: number;
}

export interface CardRecord {
  id: string;
  at: number;
  by: {
    address: string;
    handle: string;
    name: string;
  };
  text: string;
}
