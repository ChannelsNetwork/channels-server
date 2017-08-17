const jwa = require('jwa');
const secp256k1 = require('secp256k1');
const ethereumUtils = require('ethereumjs-util');
const KeyEncoder = require('key-encoder');
import * as crypto from 'crypto';

export class KeyUtils {

  static generatePrivateKey(): Uint8Array {
    let privateKeyBuffer: Buffer;
    do {
      privateKeyBuffer = crypto.randomBytes(32);
    } while (!secp256k1.privateKeyVerify(privateKeyBuffer));
    return new Uint8Array(privateKeyBuffer);
  }

  static generateValidAddress(): string {
    const privateKey = this.generatePrivateKey();
    const publicKey = secp256k1.publicKeyCreate(new Buffer(privateKey)) as Uint8Array;
    const ethPublic = ethereumUtils.importPublic(new Buffer(publicKey)) as Uint8Array;
    const ethAddress = ethereumUtils.pubToAddress(ethPublic, false) as Uint8Array;
    return new Buffer(ethAddress).toString('base64');
  }

  static getKeyInfo(privateKey: Uint8Array): KeyInfo {
    const publicKey = secp256k1.publicKeyCreate(new Buffer(privateKey)) as Uint8Array;
    const ethPublic = ethereumUtils.importPublic(new Buffer(publicKey)) as Uint8Array;
    const ethAddress = ethereumUtils.pubToAddress(ethPublic, false) as Uint8Array;
    const keyEncoder = new KeyEncoder('secp256k1');
    const result: KeyInfo = {
      privateKeyBytes: privateKey,
      privateKeyPem: keyEncoder.encodePrivate(new Buffer(privateKey).toString('hex'), 'raw', 'pem'),
      publicKeyBytes: publicKey,
      publicKeyPem: keyEncoder.encodePublic(new Buffer(publicKey).toString('hex'), 'raw', 'pem'),
      ethereumAddress: '0x' + new Buffer(ethAddress).toString('hex'),
      address: new Buffer(ethAddress).toString('base64')
    };
    return result;
  }

  static getAddressFromPublicKey(pem: string): string {
    const keyEncoder = new KeyEncoder('secp256k1');
    const publicKey = keyEncoder.encodePublic(pem, 'pem', 'raw');
    const ethPublic = ethereumUtils.importPublic(new Buffer(publicKey, 'hex')) as Uint8Array;
    const ethAddress = ethereumUtils.pubToAddress(ethPublic, false) as Uint8Array;
    return new Buffer(ethAddress).toString('base64');
  }

  static sign(object: any, keyInfo: KeyInfo): string {
    const rs256 = jwa('RS256');
    const signature = rs256.sign(JSON.stringify(object), keyInfo.privateKeyPem);
    console.log(signature);
    return signature;
  }

  static verify(object: any, publicKeyPem: string, signature: string): boolean {
    const rs256 = jwa('RS256');
    return rs256.verify(JSON.stringify(object), signature, publicKeyPem);
  }

}

export interface KeyInfo {
  privateKeyBytes: Uint8Array;
  privateKeyPem: string;
  publicKeyBytes: Uint8Array;
  publicKeyPem: string;
  ethereumAddress: string;
  address: string;
}
