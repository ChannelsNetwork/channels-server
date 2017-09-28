
import { UserRecord } from "./interfaces/db-records";

export class UserHelper {
  static getPublicKeyForAddress(user: UserRecord, address: string): string {
    for (const key of user.keys) {
      if (key.address === address) {
        return key.publicKey;
      }
    }
    return null;
  }

  static isUsersAddress(user: UserRecord, address: string): boolean {
    for (const key of user.keys) {
      if (key.address === address) {
        return true;
      }
    }
    return false;
  }
}
