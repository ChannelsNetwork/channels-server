import * as crypto from "crypto";
const parseFullName = require('parse-full-name').parseFullName;

const TOKEN_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export class Utils {
  static sleep(duration: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        resolve();
      }, duration);
    });
  }

  static createToken(length = 24): string {
    let result = '';
    const array = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      const letter = TOKEN_LETTERS.charAt(array[i] % TOKEN_LETTERS.length);
      result += letter;
    }
    return result;
  }

  static isValidPaypalRecipient(value: string) {
    if (!value) {
      return false;
    }
    const reEmail = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    const isEmail = reEmail.test(value);
    if (isEmail) {
      return true;
    }
    const phoneNumber = value.split(/[\-\.\(\)\s/]+/).join("");
    if (/^[0-9]{10,16}$/.test(phoneNumber)) {
      return true;
    }
    const rePaypalMeLink = /^(https?\:\/\/)?paypal\.me\/\S+$/i;
    if (rePaypalMeLink.test(value)) {
      return true;
    }
    return false;
  }

  static cleanPhoneNumber(phoneNumber: string, omitPlus?: boolean): string {
    if (!phoneNumber) {
      return null;
    }
    if (phoneNumber.startsWith('tel:')) {
      phoneNumber = phoneNumber.substring(4);
    }
    if (this.isNorthAmericanPhoneNumber(phoneNumber)) {
      phoneNumber = phoneNumber.replace(/\D/g, '');
      if (phoneNumber.startsWith('+')) {
        phoneNumber = phoneNumber.substr(1);
      }
      if (phoneNumber.startsWith('1')) {
        phoneNumber = phoneNumber.substr(1);
      }
      return (omitPlus ? '' : '+') + '1' + phoneNumber;
    } else {
      phoneNumber = phoneNumber.replace(/\D/g, '');
      if (phoneNumber.startsWith('+')) {
        phoneNumber = phoneNumber.substring(1);
      }
      return (omitPlus ? '' : '+') + phoneNumber;
    }
  }

  static isNorthAmericanPhoneNumber(phoneNumber: string): boolean {
    if (!phoneNumber) {
      return false;
    }
    phoneNumber = phoneNumber.trim();
    const phoneRegex = /^(\+?1\s?)?(\d{10}|\d{3}\-\d{3}\-\d{4}|\(d{3}\)\s?\d{3}\-?\d{4})$/i;
    return phoneRegex.test(phoneNumber);
  }

  static isPhoneNumber(phoneNumber: string): boolean {
    if (!phoneNumber) {
      return false;
    }
    phoneNumber = phoneNumber.trim();
    const phoneRegex = /^\+?\d[\d\-\(\)]+\d$/i;
    return phoneRegex.test(phoneNumber);
  }

  static escapeRegex(value: string): string {
    return value.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }

  static isEmailAddress(emailAddress: string): boolean {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(emailAddress);
  }

  static floorDecimal(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.floor(value * multiplier) / multiplier;
  }

  static ceilDecimal(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.ceil(value * multiplier) / multiplier;
  }

  static getFirstName(name: string): string {
    if (!name) {
      return "";
    }
    const result = parseFullName(name);
    return result.first;
  }

  static getLastName(name: string): string {
    if (!name) {
      return "";
    }
    const result = parseFullName(name);
    return result.last;
  }

  static truncate(value: string, maxLength: number, useEllipsis: boolean): string {
    if (!value) {
      return value;
    }
    if (value.length <= maxLength) {
      return value;
    }
    return useEllipsis ? value.substr(0, maxLength - 3) + '...' : value.substr(0, maxLength);
  }

  static roundToDecimal(value: number, places: number): number {
    value *= Math.pow(10, places);
    value = Math.round(value);
    value = value / Math.pow(10, places);
    return value;
  }

  static interpolateRanges(rangeValues: RangeValue[], input: number): number {
    if (input < rangeValues[0].lowerBound) {
      return rangeValues[0].value;
    }
    for (let i = 1; i < rangeValues.length; i++) {
      if (input < rangeValues[i].lowerBound) {
        return this.interpolateValues(rangeValues[i - 1], rangeValues[i], input);
      }
    }
    return rangeValues[rangeValues.length - 1].value;
  }

  static interpolateValues(lower: RangeValue, upper: RangeValue, input: number): number {
    const range = upper.lowerBound - lower.lowerBound;
    if (range === 0) {
      return (upper.value + lower.value) / 2;
    }
    if (input < lower.lowerBound) {
      return lower.value;
    }
    if (input > upper.lowerBound) {
      return upper.value;
    }
    return lower.value * (input - lower.lowerBound) / range + upper.value * (upper.lowerBound - input) / range;
  }
}

export interface RangeValue {
  lowerBound: number;
  value: number;
}
