
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
}

export interface NetworkRecord {
  id: string;
  created: number;
  balance: number;
}
