
import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import { UrlManager } from "../url-manager";
export interface ExpressWithSockets extends express.Application {
  ws: (path: string, callback: (ws: ChannelSocket, request: Request) => void) => void;
}

export interface SocketConnectionHandler {
  initializeWebsocketServices(urlManager: UrlManager, wsapp: ExpressWithSockets): Promise<void>;
}

export interface ChannelSocket {
  on: (event: string, handler: (arg?: any) => void) => void;
  send: (contents: Uint8Array) => void;
  close: () => void;
  bufferedAmount: number;
}
