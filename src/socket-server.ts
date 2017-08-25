import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { RestServer } from "./interfaces/rest-server";
import { UrlManager } from "./url-manager";
import { ExpressWithSockets, SocketConnectionHandler } from "./interfaces/express-with-sockets";
import * as uuid from 'uuid';
import { configuration } from "./configuration";
import { PingRequestDetails, SocketMessage, PingReplyDetails, OpenRequestDetails, OpenReplyDetails, PostCardDetails, PostCardReplyDetails, SocketMessageType, GetFeedDetails, GetFeedReplyDetails, MutateCardDetails, MutateCardReplyDetails } from "./interfaces/socket-messages";
import { db } from "./db";
import { KeyUtils } from "./key-utils";
import { CardRecord, UserRecord, Mutation, CardMutationRecord } from "./interfaces/db-records";
import { CardDescriptor } from "./interfaces/rest-services";

const MAX_CLOCK_SKEW = 1000 * 60 * 15;
export class SocketServer implements SocketConnectionHandler {
  private socketsById: { [id: string]: SocketInfo } = {};
  private socketsByAddress: { [address: string]: SocketInfo } = {};
  private pingInterval: number;
  private pingTimeout: number;
  private cardHandler: CardHandler;
  private feedHandler: FeedHandler;

  private async start(): Promise<void> {
    this.pingInterval = configuration.get('ping.interval', 30000);
    this.pingTimeout = configuration.get('ping.timeout', 15000);
    if (this.pingInterval > 0) {
      setInterval(() => {
        this.processPings();
      }, 1000);
    }
  }

  async initializeWebsocketServices(urlManager: UrlManager, wsapp: ExpressWithSockets): Promise<void> {
    wsapp.ws("/d/socket", (ws: ChannelSocket, request: Request) => {
      console.log("Sockets: connection requested");
      const socketId = uuid.v4();
      ws.on('message', (message: Uint8Array | string) => {
        void this.handleChannelSocketMessage(socketId, ws, message);
        return false;
      });
      ws.on('close', () => {
        void this.handleChannelSocketClose(socketId, ws);
      });
      void this.handleSocketConnectRequest(socketId, ws, request);
    });
  }

  registerCardHandler(handler: CardHandler): void {
    this.cardHandler = handler;
  }

  registerFeedHandler(handler: FeedHandler): void {
    this.feedHandler = handler;
  }

  getOpenSocketAddresses(): string[] {
    return Object.keys(this.socketsByAddress);
  }

  private async handleSocketConnectRequest(socketId: string, ws: ChannelSocket, request: Request): Promise<void> {
    this.socketsById[socketId] = {
      socketId: socketId,
      socket: ws,
      state: "pending-open",
      lastPingSent: Date.now(),
      lastPingReply: Date.now(),
      pingId: Math.floor(Math.random() * 1000),
      address: null
    };
    console.log("SocketServer: socket connected", socketId);
  }

  private async handleChannelSocketClose(socketId: string, ws: ChannelSocket): Promise<void> {
    const socket = this.socketsById[socketId];
    if (socket) {
      delete this.socketsById[socketId];
      if (socket.address) {
        delete this.socketsByAddress[socket.address];
      }
    }
    console.log("SocketServer: socket closed", socketId);
  }

  private async handleChannelSocketMessage(socketId: string, ws: ChannelSocket, message: Uint8Array | string): Promise<void> {
    console.log("SocketServer: rx", socketId, message.length);
    const socketInfo = this.socketsById[socketId];
    if (!socketInfo) {
      return;
    }
    if (typeof message === 'string') {
      let msg: any;
      try {
        msg = JSON.parse(message as string) as SocketMessage<void>;
      } catch (err) {
        console.warn("SocketServer: received non-JSON message", message);
        return;
      }
      switch (msg.type as SocketMessageType) {
        case 'ping':
          await this.handlePing(msg as SocketMessage<PingRequestDetails>, socketInfo);
          break;
        case 'ping-reply':
          await this.handlePingReply(msg as SocketMessage<PingReplyDetails>, socketInfo);
          break;
        case 'open':
          await this.handleOpenRequest(msg as SocketMessage<OpenRequestDetails>, socketInfo);
          break;
        case 'post-card':
          await this.handlePostCardRequest(msg as SocketMessage<PostCardDetails>, socketInfo);
          break;
        case 'mutate-card':
          await this.handleMutateCardRequest(msg as SocketMessage<MutateCardDetails>, socketInfo);
          break;
        case 'get-feed':
          await this.handleGetFeed(msg as SocketMessage<GetFeedDetails>, socketInfo);
          break;
        default:
          console.warn("SocketServer: received unexpected message type " + msg.type);
          break;
      }
    } else {
      console.warn("SocketServer: received non-string message.  Ignoring.", socketId);
    }
  }

  private async handlePing(msg: SocketMessage<PingRequestDetails>, socket: SocketInfo): Promise<void> {
    const details: PingReplyDetails = { success: true };
    socket.socket.send(JSON.stringify({ type: "ping-reply", requestId: msg.requestId, details: details }));
  }

  private async handlePingReply(msg: SocketMessage<PingReplyDetails>, socket: SocketInfo): Promise<void> {
    if (msg.requestId === socket.pingId.toString()) {
      socket.lastPingReply = Date.now();
    } else {
      console.warn("SocketServer: received ping-reply with unexpected requestId.  Ignoring", msg.requestId, socket.socketId);
    }
  }

  private async handleOpenRequest(msg: SocketMessage<OpenRequestDetails>, socket: SocketInfo): Promise<void> {
    if (socket.address) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 409, message: "Socket has already been opened" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    if (msg.details && msg.details.signedDetails) {
      msg.details.signedDetailsObject = JSON.parse(msg.details.signedDetails);
    }
    if (!msg.details || !msg.details.address || !msg.details.signature || !msg.details.signedDetailsObject || !msg.details.signedDetailsObject.timestamp) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 400, message: "Invalid message details" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    const user = await db.findUserByAddress(msg.details.address);
    if (!user) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 401, message: "No such user registered" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    if (!KeyUtils.verifyString(msg.details.signedDetails, user.publicKey, msg.details.signature)) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 403, message: "Invalid signature" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    if (Math.abs(Date.now() - msg.details.signedDetailsObject.timestamp) > MAX_CLOCK_SKEW) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 400, message: "Invalid timestamp" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    socket.address = user.address;
    this.socketsByAddress[user.address] = socket;
    const details: OpenReplyDetails = { success: true };
    socket.socket.send(JSON.stringify({ type: "open-reply", requestId: msg.requestId, details: details }));
  }

  private async handlePostCardRequest(msg: SocketMessage<PostCardDetails>, socket: SocketInfo): Promise<void> {
    const user = await db.findUserByAddress(socket.address);
    if (!user) {
      console.warn("SocketServer.handlePostCardRequest: missing user");
      const errDetails: PostCardReplyDetails = { success: false, error: { code: 401, message: "User is missing" }, cardId: null };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    if (!msg.details || !msg.details.text) {
      const errDetails: PostCardReplyDetails = { success: false, error: { code: 400, message: "Invalid card: text is mandatory" }, cardId: null };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    try {
      const card = await this.cardHandler.postCard(user, msg.details);
      const details: PostCardReplyDetails = {
        success: true,
        cardId: card.id
      };
      socket.socket.send(JSON.stringify({ type: "post-card-reply", requestId: msg.requestId, details: details }));
    } catch (err) {
      console.warn("SocketServer.handlePostCardRequest: failure", err);
      const errDetails: PostCardReplyDetails = { success: false, error: { code: 500, message: "Internal error" }, cardId: null };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
    }
  }

  private async handleMutateCardRequest(msg: SocketMessage<MutateCardDetails>, socket: SocketInfo): Promise<void> {
    const user = await db.findUserByAddress(socket.address);
    if (!user) {
      console.warn("SocketServer.handleMutateCardRequest: missing user");
      const errDetails: MutateCardReplyDetails = { success: false, error: { code: 401, message: "User is missing" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    if (!msg.details || !msg.details.mutation || !msg.details.mutation.type || !msg.details.mutationId) {
      const errDetails: OpenReplyDetails = { success: false, error: { code: 400, message: "Invalid message details" } };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    const mutation = await this.cardHandler.mutateCard(user, msg.details.cardId, msg.details.mutation);
    const details: MutateCardReplyDetails = { success: true };
    socket.socket.send(JSON.stringify({ type: "mutate-card-reply", requestId: msg.requestId, details: details }));
  }

  private async handleGetFeed(msg: SocketMessage<GetFeedDetails>, socket: SocketInfo): Promise<void> {
    const user = await db.findUserByAddress(socket.address);
    if (!user) {
      console.warn("SocketServer.handleGetFeed: missing user");
      const errDetails: GetFeedReplyDetails = { success: false, error: { code: 401, message: "User is missing" }, cards: [] };
      socket.socket.send(JSON.stringify({ type: "error", requestId: msg.requestId, details: errDetails }));
      return;
    }
    const cards = await this.feedHandler.getUserFeed(user.address, msg.details.maxCount, msg.details.before, msg.details.after);
    const details: GetFeedReplyDetails = {
      success: true,
      cards: cards
    };
    socket.socket.send(JSON.stringify({ type: "get-feed-reply", requestId: msg.requestId, details: details }));
  }

  private processPings(): void {
    const now = Date.now();
    for (const socketId of Object.keys(this.socketsById)) {
      const socketInfo = this.socketsById[socketId];
      if (now - socketInfo.lastPingSent > this.pingTimeout && socketInfo.lastPingReply < socketInfo.lastPingSent) {
        console.warn("SocketServer: Timeout waiting for ping-reply", socketId);
        this.closeSocket(socketId);
      } else if (now - socketInfo.lastPingSent > this.pingInterval) {
        process.nextTick(() => {
          void this.sendPing(socketInfo);
        });
      }
    }
  }

  private closeSocket(socketId: string): void {
    const socketInfo = this.socketsById[socketId];
    if (socketInfo) {
      delete this.socketsById[socketId];
      if (socketInfo.address) {
        delete this.socketsByAddress[socketInfo.address];
      }
      socketInfo.socket.close();
    }
  }

  private async sendPing(socket: SocketInfo): Promise<void> {
    const details: PingRequestDetails = {
      interval: this.pingInterval
    };
    socket.pingId++;
    socket.socket.send(JSON.stringify({ type: "ping", requestId: socket.pingId.toString(), details: details }));
    socket.lastPingSent = Date.now();
  }

  async sendEvent<T>(addresses: string[], event: SocketMessage<T>): Promise<void> {
    const msgString = JSON.stringify(event);
    for (const address of addresses) {
      const socket = this.socketsByAddress[address];
      if (socket) {
        socket.socket.send(msgString);
      }
    }
  }
}

interface SocketInfo {
  socketId: string;
  socket: ChannelSocket;
  state: "pending-open" | "active";
  lastPingSent: number;
  lastPingReply: number;
  pingId: number;
  address: string;
}

interface ChannelSocket {
  on: (event: string, handler: (arg?: any) => void) => void;
  send: (contents: Uint8Array | string) => void;
  close: () => void;
  bufferedAmount: number;
}

export interface CardHandler {
  postCard(user: UserRecord, details: PostCardDetails): Promise<CardRecord>;
  mutateCard(user: UserRecord, cardId: string, mutation: Mutation): Promise<CardMutationRecord>;
}

export interface FeedHandler {
  getUserFeed(userAddress: string, maxCount: number, before?: number, after?: number): Promise<CardDescriptor[]>;
}

const socketServer = new SocketServer();

export { socketServer };
