import { Request, Response } from 'express';
import { Signable, RestRequest } from "./interfaces/rest-services";
import { KeyUtils } from "./key-utils";
import { db } from "./db";
import { UserRecord } from "./interfaces/db-records";

const MAX_CLOCK_SKEW = 1000 * 60 * 15;

export class RestHelper {
  static validateBasicRequest<T extends Signable>(requestBody: RestRequest<T>, response: Response): boolean {
    if (!requestBody || !requestBody.version || requestBody.version !== 1 || !requestBody.details || !requestBody.signature) {
      response.status(400).send("Invalid request body or unsupported version");
      return false;
    }
    requestBody.detailsObject = JSON.parse(requestBody.details);
    return true;
  }

  static validateRequest<T extends Signable>(requestBody: RestRequest<T>, publicKey: string, response: Response): boolean {
    if (!this.validateBasicRequest(requestBody, response)) {
      return false;
    }
    try {
      if (!publicKey) {
        response.status(401).send("No public key available");
        return;
      }
      if (!KeyUtils.verifyString(requestBody.details, publicKey, requestBody.signature)) {
        response.status(403).send("Signature is invalid");
        return;
      }
      if (!requestBody.detailsObject.timestamp || Math.abs(Date.now() - requestBody.detailsObject.timestamp) > MAX_CLOCK_SKEW) {
        response.status(400).send("Timestamp is not current");
        return;
      }
    } catch (err) {
      response.status(401).send("Public key is not valid");
      return;
    }
    return true;
  }

  static async validateRegisteredRequest<T extends Signable>(requestBody: RestRequest<T>, response: Response): Promise<UserRecord> {
    if (!this.validateBasicRequest(requestBody, response)) {
      return null;
    }
    const userRecord = await db.findUserByAddress(requestBody.detailsObject.address);
    if (!userRecord) {
      response.status(401).send("No such registered users");
      return null;
    }
    const publicKey = userRecord.publicKey;
    if (!this.validateRequest(requestBody, publicKey, response)) {
      return null;
    }
    await db.updateLastUserContact(userRecord, Date.now());
    return userRecord;
  }
}
