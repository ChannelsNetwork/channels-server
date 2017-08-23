
import { CardDescriptor } from "./rest-services";
import { Mutation, CardStateGroup } from "./db-records";

export type SocketMessageType = 'ping' | 'ping-reply' | 'open' | 'open-reply' | 'get-feed' | 'get-feed-reply' | 'post-card' | 'post-card-reply' | 'mutate-card' | 'mutate-card-reply' | 'notify-card-posted' | 'notify-mutation';
export interface SocketMessage<T> {
  type: SocketMessageType;
  requestId?: string;
  details: T;
}

export interface ReplyDetails {
  success: boolean;
  error?: {
    code: number;
    message: string;
  };
}

export interface PingRequestDetails {
  interval: number;
}

export interface PingReplyDetails extends ReplyDetails { }

export interface OpenRequestDetails {
  address: string;
  signedDetails: {
    timestamp: number;
  };
  signature: string;
}

export interface OpenReplyDetails extends ReplyDetails { }

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

export interface PostCardReplyDetails extends ReplyDetails {
  cardId: string;
}

export interface CardState {
  mutationId: string;
  properties: { [name: string]: any };
  collections: { [name: string]: { [key: string]: any } };
}

export interface MutateCardDetails {
  mutationId: string;
  cardId: string;
  mutation: Mutation;
}

export interface MutateCardReplyDetails extends ReplyDetails { }

export interface NotifyCardPostedDetails extends CardDescriptor { }

export interface NotifyCardMutationDetails {
  mutationId: string;
  cardId: string;
  by: string;
  at: number;
  mutation: Mutation;
}

export interface GetFeedDetails {
  before?: number;
  after?: number;
  maxCount: number;
}

export interface GetFeedReplyDetails extends ReplyDetails {
  cards: CardDescriptor[];
}
