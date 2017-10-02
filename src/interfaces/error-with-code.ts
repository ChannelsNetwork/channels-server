export class ErrorWithStatusCode extends Error implements HasStatusCode {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface HasStatusCode {
  code: number;
}
