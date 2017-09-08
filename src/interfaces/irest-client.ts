import { Response } from 'express';
export interface PostArgs {
  data: any;
  headers: { [name: string]: string };
}
export interface RestArgs {
  headers: { [name: string]: string };
}

export interface IRestClient {
  get(url: string, callback: (data: any, response: Response) => void): void;

  get(url: string, args: RestArgs, callback: (data: any, response: Response) => void): void;
  post(url: string, args: PostArgs, callback: (data: any, response: Response) => void): void;
  delete(url: string, args: RestArgs, callback: (data: any, response: Response) => void): void;
}
