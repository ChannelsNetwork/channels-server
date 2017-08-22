
import { CardDescriptor } from "./rest-services";
import { Mutation, CardStateGroup } from "./db-records";

export type SocketMessageType = 'ping' | 'ping-reply' | 'open' | 'get-feed' | 'get-feed-reply' | 'post-card' | 'post-card-reply' | 'notify-card-posted' | 'notify-mutation' | 'error';
export interface SocketMessage<T> {
  type: SocketMessageType;
  requestId?: string;
  details: T;
}

export interface ErrorReplyDetails {
  code: number;
  message: string;
}

export interface PingRequestDetails {
  interval: number;
}

export interface PingReplyDetails { }

export interface OpenRequestDetails {
  address: string;
  signedDetails: {
    timestamp: number;
  };
  signature: string;
}

export interface OpenReplyDetails { }

export interface PostCardDetails {
  imageUrl?: string;
  linkUrl?: string;
  title: string;
  text: string;
  cardType: string;
  state: {
    user: CardState;
    shared: CardState;
  };
}

export interface PostCardReplyDetails {
  cardId: string;
}
export interface CardState {
  mutationId: string;
  properties: { [name: string]: any };
  collections: { [name: string]: { [key: string]: any } };
}

export interface NotifyCardPostedDetails extends CardDescriptor { }

export interface NotifyCardMutationDetails {
  mutationId: string;
  cardId: string;
  group: CardStateGroup;
  by: string;
  at: number;
  mutation: Mutation;
}

export interface GetFeedDetails {
  before?: number;
  after?: number;
  maxCount: number;
}

export interface GetFeedReplyDetails {
  cards: CardDescriptor[];
}
