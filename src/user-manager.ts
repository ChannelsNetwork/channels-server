import * as express from "express";
// tslint:disable-next-line:no-duplicate-imports
import { Request, Response } from 'express';
import * as net from 'net';
import { configuration } from "./configuration";
import { RestServer } from './interfaces/rest-server';
import { RestRequest, RegisterUserDetails, UserStatusDetails, Signable, UserStatusResponse, UpdateUserIdentityDetails, CheckHandleDetails, GetUserIdentityDetails, GetUserIdentityResponse, UpdateUserIdentityResponse, CheckHandleResponse, BankTransactionRecipientDirective, BankTransactionDetails, RegisterUserResponse, UserStatus, SignInDetails, SignInResponse, RequestRecoveryCodeDetails, RequestRecoveryCodeResponse, RecoverUserDetails, RecoverUserResponse, GetHandleDetails, GetHandleResponse, AdminGetUsersDetails, AdminGetUsersResponse, AdminSetUserMailingListDetails, AdminSetUserMailingListResponse, AdminUserInfo, AdminSetUserCurationResponse, AdminSetUserCurationDetails, UserDescriptor, ConfirmEmailDetails, ConfirmEmailResponse, RequestEmailConfirmationDetails, RequestEmailConfirmationResponse, AccountSettings, UpdateAccountSettingsDetails, UpdateAccountSettingsResponse, PromotionPricingInfo, GeoTargetDescriptor, GetGeoDescriptorsDetails, GetGeoDescriptorsResponse, CodeAndName, GetCommunityInfoDetails, GetCommunityInfoResponse, GetCommunityInfoMoreDetails, GetCommunityInfoMoreResponse, CommunityInfoListType, CommunityMemberInfo, AdminGetAuthorUserStatsResponse, AdminGetAuthorUserStatsDetails } from "./interfaces/rest-services";
import { db, AuthorUserAggregationAdminItem } from "./db";
import { UserRecord, IpAddressRecord, IpAddressStatus, GeoLocation } from "./interfaces/db-records";
import * as NodeRSA from "node-rsa";
import { UrlManager } from "./url-manager";
import { KeyUtils, KeyInfo } from "./key-utils";
import { RestHelper } from "./rest-helper";
import { socketServer, UserSocketHandler } from "./socket-server";
import { priceRegulator } from "./price-regulator";
import { networkEntity } from "./network-entity";
import { Initializable } from "./interfaces/initializable";
import { bank, TARGET_BALANCE, MINIMUM_BALANCE_AFTER_WITHDRAWAL } from "./bank";
import { emailManager, EmailButton } from "./email-manager";
import { SERVER_VERSION } from "./server-version";
import * as uuid from "uuid";
import { Utils } from "./utils";
import fetch from "node-fetch";
import { fileManager } from "./file-manager";
import * as LRU from 'lru-cache';
import { channelManager } from "./channel-manager";
import { errorManager } from "./error-manager";
import { NotificationHandler, ChannelsServerNotification, awsManager } from "./aws-manager";
import { PROMOTION_PRICING } from "./card-manager";
const { URL } = require("url");

const INVITER_REWARD = 1;
const INVITEE_REWARD = 1;
const INVITATIONS_ALLOWED = 5;
const LETTERS = 'abcdefghjklmnpqrstuvwxyz';
const DIGITS = '0123456789';
const URL_SYMBOLS = '-._~';
const CODE_SYMBOLS = LETTERS + LETTERS.toUpperCase() + DIGITS + URL_SYMBOLS;
const NON_ZERO_DIGITS = '123456789';
const ANNUAL_INTEREST_RATE = 0.03;
const INTEREST_RATE_PER_MILLISECOND = Math.pow(1 + ANNUAL_INTEREST_RATE, 1 / (365 * 24 * 60 * 60 * 1000)) - 1;
const MIN_INTEREST_INTERVAL = 1000 * 60 * 15;
const BALANCE_UPDATE_INTERVAL = 1000 * 60 * 60 * 24;
const BALANCE_DORMANT_ACCOUNT_INTERVAL = 1000 * 60 * 60 * 24 * 45;
const RECOVERY_CODE_LIFETIME = 1000 * 60 * 10;
const MAX_USER_IP_ADDRESSES = 64;
const INITIAL_BALANCE = 1;
const REGISTRATION_BONUS = 1.5;
const STALE_USER_INTERVAL = 1000 * 60 * 60 * 24 * 30;
const MAX_STALE_USERS_PER_CYCLE = 1000;

const MAX_IP_ADDRESS_LIFETIME = 1000 * 60 * 60 * 24 * 30;
const IP_ADDRESS_FAIL_RETRY_INTERVAL = 1000 * 60 * 60 * 24;
const MINIMUM_WITHDRAWAL_INTERVAL = 1000 * 60 * 60 * 24 * 7;

const continentNameByContinentCode: { [continentCode: string]: string } = {
  "AF": "Africa",
  "AS": "Asia",
  "EU": "Europe",
  "OC": "Oceania",
  "NA": "North America",
  "SA": "South America"
};

const infoByCountryCode: { [countryCode: string]: CountryInfo } = {
  "AD": { continentCode: "EU", name: "Andorra" },
  "AE": { continentCode: "AS", name: "United Arab Emirates" },
  "AF": { continentCode: "AS", name: "Afghanistan" },
  "AG": { continentCode: "NA", name: "Antigua and Barbuda" },
  "AI": { continentCode: "NA", name: "Anguilla" },
  "AL": { continentCode: "EU", name: "Albania" },
  "AM": { continentCode: "EU", name: "Armenia" },
  "AO": { continentCode: "AF", name: "Angola" },
  "AR": { continentCode: "SA", name: "Argentina" },
  "AS": { continentCode: "OC", name: "American Samoa" },
  "AT": { continentCode: "EU", name: "Austria" },
  "AU": { continentCode: "OC", name: "Australia" },
  "AW": { continentCode: "NA", name: "Aruba" },
  "AX": { continentCode: "EU", name: "Åland Islands" },
  "AZ": { continentCode: "EU", name: "Azerbaijan" },
  "BA": { continentCode: "EU", name: "Bosnia and Herzegovina" },
  "BB": { continentCode: "NA", name: "Barbados" },
  "BD": { continentCode: "AS", name: "Bangladesh" },
  "BE": { continentCode: "EU", name: "Belgium" },
  "BF": { continentCode: "AF", name: "Burkina Faso" },
  "BG": { continentCode: "EU", name: "Bulgaria" },
  "BH": { continentCode: "AS", name: "Bahrain" },
  "BI": { continentCode: "AF", name: "Burundi" },
  "BJ": { continentCode: "AF", name: "Benin" },
  "BL": { continentCode: "NA", name: "Saint Barthélemy" },
  "BM": { continentCode: "NA", name: "Bermuda" },
  "BN": { continentCode: "AS", name: "Brunei Darussalam" },
  "BO": { continentCode: "SA", name: "Bolivia (Plurinational State of)" },
  "BQ": { continentCode: "SA", name: "Bonaire, Sint Eustatius and Saba" },
  "BR": { continentCode: "SA", name: "Brazil" },
  "BS": { continentCode: "NA", name: "Bahamas" },
  "BT": { continentCode: "AS", name: "Bhutan" },
  "BW": { continentCode: "AF", name: "Botswana" },
  "BY": { continentCode: "EU", name: "Belarus" },
  "BZ": { continentCode: "NA", name: "Belize" },
  "CA": { continentCode: "NA", name: "Canada" },
  "CC": { continentCode: "AS", name: "Cocos (Keeling) Islands" },
  "CD": { continentCode: "AF", name: "Congo (Democratic Republic of the)" },
  "CF": { continentCode: "AF", name: "Central African Republic" },
  "CG": { continentCode: "AF", name: "Congo" },
  "CH": { continentCode: "EU", name: "Switzerland" },
  "CI": { continentCode: "AF", name: "Côte d'Ivoire" },
  "CK": { continentCode: "OC", name: "Cook Islands" },
  "CL": { continentCode: "SA", name: "Chile" },
  "CM": { continentCode: "AF", name: "Cameroon" },
  "CN": { continentCode: "AS", name: "China" },
  "CO": { continentCode: "SA", name: "Colombia" },
  "CR": { continentCode: "NA", name: "Costa Rica" },
  "CU": { continentCode: "NA", name: "Cuba" },
  "CV": { continentCode: "AF", name: "Cabo Verde" },
  "CW": { continentCode: "NA", name: "Curaçao" },
  "CX": { continentCode: "AS", name: "Christmas Island" },
  "CY": { continentCode: "EU", name: "Cyprus" },
  "CZ": { continentCode: "EU", name: "Czechia" },
  "DE": { continentCode: "EU", name: "Germany" },
  "DJ": { continentCode: "AF", name: "Djibouti" },
  "DK": { continentCode: "EU", name: "Denmark" },
  "DM": { continentCode: "NA", name: "Dominica" },
  "DO": { continentCode: "NA", name: "Dominican Republic" },
  "DZ": { continentCode: "AF", name: "Algeria" },
  "EC": { continentCode: "SA", name: "Ecuador" },
  "EE": { continentCode: "EU", name: "Estonia" },
  "EG": { continentCode: "AF", name: "Egypt" },
  "EH": { continentCode: "AF", name: "Western Sahara" },
  "ER": { continentCode: "AF", name: "Eritrea" },
  "ES": { continentCode: "EU", name: "Spain" },
  "ET": { continentCode: "AF", name: "Ethiopia" },
  "FI": { continentCode: "EU", name: "Finland" },
  "FJ": { continentCode: "OC", name: "Fiji" },
  "FK": { continentCode: "SA", name: "Falkland Islands (Malvinas)" },
  "FM": { continentCode: "OC", name: "Micronesia (Federated States of)" },
  "FO": { continentCode: "EU", name: "Faroe Islands" },
  "FR": { continentCode: "EU", name: "France" },
  "GA": { continentCode: "AF", name: "Gabon" },
  "GB": { continentCode: "EU", name: "United Kingdom of Great Britain and Northern Ireland" },
  "GD": { continentCode: "NA", name: "Grenada" },
  "GE": { continentCode: "AS", name: "Georgia" },
  "GF": { continentCode: "SA", name: "French Guiana" },
  "GG": { continentCode: "EU", name: "Guernsey" },
  "GH": { continentCode: "AF", name: "Ghana" },
  "GI": { continentCode: "EU", name: "Gibraltar" },
  "GL": { continentCode: "NA", name: "Greenland" },
  "GM": { continentCode: "AF", name: "Gambia" },
  "GN": { continentCode: "AF", name: "Guinea" },
  "GP": { continentCode: "NA", name: "Guadeloupe" },
  "GQ": { continentCode: "AF", name: "Equatorial Guinea" },
  "GR": { continentCode: "EU", name: "Greece" },
  "GT": { continentCode: "NA", name: "Guatemala" },
  "GU": { continentCode: "OC", name: "Guam" },
  "GW": { continentCode: "AF", name: "Guinea-Bissau" },
  "GY": { continentCode: "SA", name: "Guyana" },
  "HK": { continentCode: "AS", name: "Hong Kong" },
  "HM": { continentCode: "OC", name: "Heard Island and McDonald Islands" },
  "HN": { continentCode: "NA", name: "Honduras" },
  "HR": { continentCode: "EU", name: "Croatia" },
  "HT": { continentCode: "NA", name: "Haiti" },
  "HU": { continentCode: "EU", name: "Hungary" },
  "ID": { continentCode: "AS", name: "Indonesia" },
  "IE": { continentCode: "EU", name: "Ireland" },
  "IL": { continentCode: "AS", name: "Israel" },
  "IM": { continentCode: "EU", name: "Isle of Man" },
  "IN": { continentCode: "AS", name: "India" },
  "IO": { continentCode: "AS", name: "British Indian Ocean Territory" },
  "IQ": { continentCode: "AS", name: "Iraq" },
  "IR": { continentCode: "AS", name: "Iran (Islamic Republic of)" },
  "IS": { continentCode: "EU", name: "Iceland" },
  "IT": { continentCode: "EU", name: "Italy" },
  "JE": { continentCode: "EU", name: "Jersey" },
  "JM": { continentCode: "NA", name: "Jamaica" },
  "JO": { continentCode: "AS", name: "Jordan" },
  "JP": { continentCode: "AS", name: "Japan" },
  "KE": { continentCode: "AF", name: "Kenya" },
  "KG": { continentCode: "AS", name: "Kyrgyzstan" },
  "KH": { continentCode: "AS", name: "Cambodia" },
  "KI": { continentCode: "OC", name: "Kiribati" },
  "KM": { continentCode: "AF", name: "Comoros" },
  "KN": { continentCode: "NA", name: "Saint Kitts and Nevis" },
  "KP": { continentCode: "AS", name: "Korea (Democratic People's Republic of)" },
  "KR": { continentCode: "AS", name: "Korea (Republic of)" },
  "KW": { continentCode: "AS", name: "Kuwait" },
  "KY": { continentCode: "NA", name: "Cayman Islands" },
  "KZ": { continentCode: "AS", name: "Kazakhstan" },
  "LA": { continentCode: "AS", name: "Lao People's Democratic Republic" },
  "LB": { continentCode: "AS", name: "Lebanon" },
  "LC": { continentCode: "NA", name: "Saint Lucia" },
  "LI": { continentCode: "EU", name: "Liechtenstein" },
  "LK": { continentCode: "AS", name: "Sri Lanka" },
  "LR": { continentCode: "AF", name: "Liberia" },
  "LS": { continentCode: "AF", name: "Lesotho" },
  "LT": { continentCode: "EU", name: "Lithuania" },
  "LU": { continentCode: "EU", name: "Luxembourg" },
  "LV": { continentCode: "EU", name: "Latvia" },
  "LY": { continentCode: "AF", name: "Libya" },
  "MA": { continentCode: "AF", name: "Morocco" },
  "MC": { continentCode: "EU", name: "Monaco" },
  "MD": { continentCode: "EU", name: "Moldova (Republic of)" },
  "ME": { continentCode: "EU", name: "Montenegro" },
  "MF": { continentCode: "NA", name: "Saint Martin (French part)" },
  "MG": { continentCode: "AF", name: "Madagascar" },
  "MH": { continentCode: "OC", name: "Marshall Islands" },
  "MK": { continentCode: "EU", name: "Macedonia (the former Yugoslav Republic of)" },
  "ML": { continentCode: "AF", name: "Mali" },
  "MM": { continentCode: "AS", name: "Myanmar" },
  "MN": { continentCode: "AS", name: "Mongolia" },
  "MO": { continentCode: "AS", name: "Macao" },
  "MP": { continentCode: "OC", name: "Northern Mariana Islands" },
  "MQ": { continentCode: "NA", name: "Martinique" },
  "MR": { continentCode: "AF", name: "Mauritania" },
  "MS": { continentCode: "NA", name: "Montserrat" },
  "MT": { continentCode: "EU", name: "Malta" },
  "MU": { continentCode: "AF", name: "Mauritius" },
  "MV": { continentCode: "AS", name: "Maldives" },
  "MW": { continentCode: "AF", name: "Malawi" },
  "MX": { continentCode: "NA", name: "Mexico" },
  "MY": { continentCode: "AS", name: "Malaysia" },
  "MZ": { continentCode: "AF", name: "Mozambique" },
  "NA": { continentCode: "AF", name: "Namibia" },
  "NC": { continentCode: "OC", name: "New Caledonia" },
  "NE": { continentCode: "AF", name: "Niger" },
  "NF": { continentCode: "OC", name: "Norfolk Island" },
  "NG": { continentCode: "AF", name: "Nigeria" },
  "NI": { continentCode: "NA", name: "Nicaragua" },
  "NL": { continentCode: "EU", name: "Netherlands" },
  "NO": { continentCode: "EU", name: "Norway" },
  "NP": { continentCode: "AS", name: "Nepal" },
  "NR": { continentCode: "OC", name: "Nauru" },
  "NU": { continentCode: "OC", name: "Niue" },
  "NZ": { continentCode: "OC", name: "New Zealand" },
  "OM": { continentCode: "AS", name: "Oman" },
  "PA": { continentCode: "NA", name: "Panama" },
  "PE": { continentCode: "SA", name: "Peru" },
  "PF": { continentCode: "OC", name: "French Polynesia" },
  "PG": { continentCode: "OC", name: "Papua New Guinea" },
  "PH": { continentCode: "OC", name: "Philippines" },
  "PK": { continentCode: "AS", name: "Pakistan" },
  "PL": { continentCode: "EU", name: "Poland" },
  "PM": { continentCode: "NA", name: "Saint Pierre and Miquelon" },
  "PN": { continentCode: "OC", name: "Pitcairn" },
  "PR": { continentCode: "NA", name: "Puerto Rico" },
  "PS": { continentCode: "AS", name: "Palestine, State of" },
  "PT": { continentCode: "EU", name: "Portugal" },
  "PW": { continentCode: "OC", name: "Palau" },
  "PY": { continentCode: "SA", name: "Paraguay" },
  "QA": { continentCode: "AS", name: "Qatar" },
  "RE": { continentCode: "AF", name: "Réunion" },
  "RO": { continentCode: "EU", name: "Romania" },
  "RS": { continentCode: "EU", name: "Serbia" },
  "RU": { continentCode: "AS", name: "Russian Federation" },
  "RW": { continentCode: "AF", name: "Rwanda" },
  "SA": { continentCode: "AS", name: "Saudi Arabia" },
  "SB": { continentCode: "OC", name: "Solomon Islands" },
  "SC": { continentCode: "NA", name: "Seychelles" },
  "SD": { continentCode: "AF", name: "Sudan" },
  "SE": { continentCode: "EU", name: "Sweden" },
  "SG": { continentCode: "AS", name: "Singapore" },
  "SH": { continentCode: "AF", name: "Saint Helena, Ascension and Tristan da Cunha" },
  "SI": { continentCode: "EU", name: "Slovenia" },
  "SJ": { continentCode: "EU", name: "Svalbard and Jan Mayen" },
  "SK": { continentCode: "EU", name: "Slovakia" },
  "SL": { continentCode: "AF", name: "Sierra Leone" },
  "SM": { continentCode: "EU", name: "San Marino" },
  "SN": { continentCode: "AF", name: "Senegal" },
  "SO": { continentCode: "AF", name: "Somalia" },
  "SR": { continentCode: "SA", name: "Suriname" },
  "SS": { continentCode: "AF", name: "South Sudan" },
  "ST": { continentCode: "AF", name: "Sao Tome and Principe" },
  "SV": { continentCode: "NA", name: "El Salvador" },
  "SX": { continentCode: "NA", name: "Sint Maarten (Dutch part)" },
  "SY": { continentCode: "AS", name: "Syrian Arab Republic" },
  "SZ": { continentCode: "AF", name: "Swaziland" },
  "TC": { continentCode: "NA", name: "Turks and Caicos Islands" },
  "TD": { continentCode: "AF", name: "Chad" },
  "TG": { continentCode: "AF", name: "Togo" },
  "TH": { continentCode: "AS", name: "Thailand" },
  "TJ": { continentCode: "AS", name: "Tajikistan" },
  "TK": { continentCode: "OC", name: "Tokelau" },
  "TL": { continentCode: "OC", name: "Timor-Leste" },
  "TM": { continentCode: "AS", name: "Turkmenistan" },
  "TN": { continentCode: "AF", name: "Tunisia" },
  "TO": { continentCode: "AF", name: "Tonga" },
  "TR": { continentCode: "EU", name: "Turkey" },
  "TT": { continentCode: "NA", name: "Trinidad and Tobago" },
  "TV": { continentCode: "OC", name: "Tuvalu" },
  "TW": { continentCode: "AS", name: "Taiwan, Province of China[a]" },
  "TZ": { continentCode: "AF", name: "Tanzania, United Republic of" },
  "UA": { continentCode: "EU", name: "Ukraine" },
  "UG": { continentCode: "AF", name: "Uganda" },
  "UM": { continentCode: "OC", name: "United States Minor Outlying Islands" },
  "US": { continentCode: "NA", name: "United States of America" },
  "UY": { continentCode: "SA", name: "Uruguay" },
  "UZ": { continentCode: "AS", name: "Uzbekistan" },
  "VA": { continentCode: "EU", name: "Holy See" },
  "VC": { continentCode: "NA", name: "Saint Vincent and the Grenadines" },
  "VE": { continentCode: "SA", name: "Venezuela (Bolivarian Republic of)" },
  "VG": { continentCode: "NA", name: "Virgin Islands (British)" },
  "VI": { continentCode: "NA", name: "Virgin Islands (U.S.)" },
  "VN": { continentCode: "AS", name: "Viet Nam" },
  "VU": { continentCode: "OC", name: "Vanuatu" },
  "WF": { continentCode: "OC", name: "Wallis and Futuna" },
  "WS": { continentCode: "OC", name: "Samoa" },
  "XK": { continentCode: "EU", name: "Kosovo" },
  "YE": { continentCode: "AF", name: "Yemen" },
  "YT": { continentCode: "AF", name: "Mayotte" },
  "ZA": { continentCode: "AF", name: "South Africa" },
  "ZM": { continentCode: "AF", name: "Zambia" },
  "ZW": { continentCode: "AF", name: "Zimbabwe" },
};

export class UserManager implements RestServer, UserSocketHandler, Initializable, NotificationHandler {
  private app: express.Application;
  private urlManager: UrlManager;
  private goLiveDate: number;
  private userCache = LRU<string, UserRecord>({ max: 10000, maxAge: 1000 * 60 * 5 });
  private ipCache = LRU<string, IpAddressRecord>({ max: 10000, maxAge: 1000 * 60 * 60 });

  private countryCache = LRU<string, string>({ max: 10000, maxAge: 1000 * 60 * 60 * 24 });
  private regionCache = LRU<string, string>({ max: 10000, maxAge: 1000 * 60 * 60 * 24 });

  private countryRegionsCache = LRU<string, CodeAndName[]>({ max: 10000, maxAge: 1000 * 60 * 60 * 3 });

  async initialize(urlManager: UrlManager): Promise<void> {
    this.urlManager = urlManager;
    socketServer.setUserHandler(this);
    this.goLiveDate = new Date(2017, 11, 15, 12, 0, 0, 0).getTime();
  }

  async initializeRestServices(urlManager: UrlManager, app: express.Application): Promise<void> {
    this.app = app;
    this.registerHandlers();
  }

  async initialize2(): Promise<void> {
    // const oldUsers = await db.getOldUsers();
    // for (const oldUser of oldUsers) {
    //   const existing = await db.findUserById(oldUser.id);
    //   if (!existing && oldUser.keys.length > 0 && oldUser.keys[0].address && oldUser.keys[0].publicKey && oldUser.id && oldUser.identity && oldUser.identity.handle) {
    //     const user = await db.insertUser("normal", oldUser.keys[0].address, oldUser.keys[0].publicKey, null, null, uuid.v4(), 0, 0, DEFAULT_TARGET_BALANCE, DEFAULT_TARGET_BALANCE, null, oldUser.id, oldUser.identity);
    //     await db.incrementUserBalance(user, oldUser.balance, false, Date.now());
    //     console.log("UserManager.initialize2: Migrated old user " + oldUser.id + " to new structure with balance = " + oldUser.balance);
    //   }
    // }
    // const users = await db.findUsersWithoutCountry();
    // for (const user of users) {
    //   if (user.ipAddresses.length > 0) {
    //     const result = await this.fetchIpAddressInfo(user.ipAddresses[user.ipAddresses.length - 1]);
    //     if (result) {
    //       await db.updateUserGeo(user.id, result.countryCode, result.region, result.city, result.zip);
    //     } else {
    //       await db.updateUserGeo(user.id, null, null, null, null);
    //     }
    //   } else {
    //     await db.updateUserGeo(user.id, null, null, null, null);
    //   }
    // }
    // const withImageUrl = await db.findUsersWithImageUrl();
    // const baseFileUrl = this.urlManager.getAbsoluteUrl('/');
    // for (const user of withImageUrl) {
    //   const imageUrl = user.identity.imageUrl;
    //   if (imageUrl && imageUrl.indexOf(baseFileUrl) === 0) {
    //     const fileId = imageUrl.substr(baseFileUrl.length).split('/')[0];
    //     if (/^[0-9a-z\-]{36}$/i.test(fileId)) {
    //       await db.replaceUserImageUrl(user.id, fileId);
    //       console.log("User.initialize2: replaced imageUrl with imageId", user.identity.imageUrl, fileId);
    //     } else {
    //       console.log("User.initialize2: Unable to replace user imageUrl because not in GUID format", user.identity);
    //     }
    //   }
    // }

    // const withdrawals = await db.listManualWithdrawals(1000);
    // for (const withdrawal of withdrawals) {
    //   const user = await this.getUser(withdrawal.userId, true);
    //   if (user) {
    //     if (!user.lastWithdrawal || withdrawal.created > user.lastWithdrawal) {
    //       console.log("User.initialize2: Updating user last withdrawal", user.id, withdrawal.created);
    //       await db.updateUserLastWithdrawal(user, withdrawal.created);
    //     }
    //   }
    // }

    // console.log("User.initialize2:  Checking for unconfirmed users who haven't received confirmation request...");
    // const unconfirmedUsers = db.getUnconfirmedUsersWithNoLastNotice();
    // while (await unconfirmedUsers.hasNext()) {
    //   const unconfirmedUser = await unconfirmedUsers.next();
    //   if (!unconfirmedUser.curation) {
    //     await this.sendEmailConfirmation(unconfirmedUser);
    //   }
    // }

    setInterval(() => {
      void this.poll();
    }, 120000);
    await this.poll();
  }

  private registerHandlers(): void {
    this.app.post(this.urlManager.getDynamicUrl('register-user'), (request: Request, response: Response) => {
      void this.handleRegisterUser(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('sign-in'), (request: Request, response: Response) => {
      void this.handleSignIn(request, response);
    });
    // this.app.post(this.urlManager.getDynamicUrl('register-device'), (request: Request, response: Response) => {
    //   void this.handleRegisterDevice(request, response);
    // });
    this.app.post(this.urlManager.getDynamicUrl('account-status'), (request: Request, response: Response) => {
      void this.handleStatus(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-identity'), (request: Request, response: Response) => {
      void this.handleUpdateIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('update-account-settings'), (request: Request, response: Response) => {
      void this.handleUpdateAccountSettings(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('request-recovery-code'), (request: Request, response: Response) => {
      void this.handleRequestRecoveryCode(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('recover-user'), (request: Request, response: Response) => {
      void this.handleRecoverUser(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-identity'), (request: Request, response: Response) => {
      void this.handleGetIdentity(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('check-handle'), (request: Request, response: Response) => {
      void this.handleCheckHandle(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-handle'), (request: Request, response: Response) => {
      void this.handleGetHandle(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('request-email-confirmation'), (request: Request, response: Response) => {
      void this.handleRequestEmailConfirmation(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('confirm-email'), (request: Request, response: Response) => {
      void this.handleConfirmEmail(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-users'), (request: Request, response: Response) => {
      void this.handleAdminGetUsers(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-set-user-mailing-list'), (request: Request, response: Response) => {
      void this.handleAdminSetUserMailingList(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-set-user-curation'), (request: Request, response: Response) => {
      void this.handleAdminSetUserCuration(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-geo-descriptors'), (request: Request, response: Response) => {
      void this.handleGetGeoDescriptors(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-community-info'), (request: Request, response: Response) => {
      void this.handleGetCommunityInfo(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('get-community-info-more'), (request: Request, response: Response) => {
      void this.handleGetCommunityInfoMore(request, response);
    });
    this.app.post(this.urlManager.getDynamicUrl('admin-get-referrals'), (request: Request, response: Response) => {
      void this.handleAdminGetReferrals(request, response);
    });
  }

  async handleNotification(notification: ChannelsServerNotification): Promise<void> {
    switch (notification.type) {
      case 'user-updated':
        await this.handleUserUpdatedNotification(notification);
        break;
      default:
        break;
    }
  }

  private async handleUserUpdatedNotification(notification: ChannelsServerNotification): Promise<void> {
    console.log("UserManager.handleUserUpdatedNotification");
    this.userCache.del(notification.user);
  }

  private async announceUserUpdated(user: UserRecord): Promise<void> {
    const notification: ChannelsServerNotification = {
      type: 'user-updated',
      user: user.id
    };
    await awsManager.sendSns(notification);
    this.userCache.del(user.id);
  }

  async getUser(userId: string, force: boolean): Promise<UserRecord> {
    let result = this.userCache.get(userId);
    if (result && !force) {
      return result;
    }
    result = await db.findUserById(userId);
    if (result) {
      this.userCache.set(userId, result);
    }
    return result;
  }

  async getUserByAddress(address: string): Promise<UserRecord> {
    const result = await db.findUserByAddress(address);
    if (result) {
      this.userCache.set(result.id, result);
    }
    return result;
  }

  async getUserByHandle(handle: string): Promise<UserRecord> {
    const result = await db.findUserByHandle(handle);
    if (result) {
      this.userCache.set(result.id, result);
    }
    return result;
  }

  private async handleRegisterUser(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RegisterUserDetails>;
      requestBody.detailsObject = JSON.parse(requestBody.details);
      if (!RestHelper.validateRequest(requestBody, requestBody.detailsObject ? requestBody.detailsObject.publicKey : null, response)) {
        return;
      }
      if (!requestBody.detailsObject.address || !requestBody.detailsObject.publicKey) {
        response.status(400).send("Invalid request-user details");
        return;
      }
      if (KeyUtils.getAddressFromPublicKey(requestBody.detailsObject.publicKey) !== requestBody.detailsObject.address) {
        response.status(400).send("This address is inconsistent with the publicKey provided.");
        return;
      }
      console.log("UserManager.register-user", requestBody.detailsObject.address);
      const ipAddress = this.getIpAddressFromRequest(request);
      let ipAddressInfo: IpAddressRecord;
      if (ipAddress && ipAddress.length > 0) {
        ipAddressInfo = await this.fetchIpAddressInfo(ipAddress, false);
      }
      console.log("UserManager.register-user:", request.headers, ipAddress);
      const isMobile = requestBody.detailsObject.userAgent && requestBody.detailsObject.userAgent.toLowerCase().indexOf('mobi') >= 0;
      let userRecord = await this.getUserByAddress(requestBody.detailsObject.address);
      if (userRecord) {
        if (ipAddress && userRecord.ipAddresses.indexOf(ipAddress) < 0) {
          await db.addUserIpAddress(userRecord, ipAddress, ipAddressInfo ? ipAddressInfo.country : null, ipAddressInfo ? ipAddressInfo.region : null, ipAddressInfo ? ipAddressInfo.city : null, ipAddressInfo ? ipAddressInfo.zip : null);
          if (userRecord.ipAddresses.length > MAX_USER_IP_ADDRESSES) {
            await db.discardUserIpAddress(userRecord, userRecord.ipAddresses[0]);
          }
        } else if (ipAddressInfo && ipAddressInfo.city && ipAddressInfo.city !== userRecord.city) {
          await db.updateUserGeo(userRecord.id, ipAddressInfo.country, ipAddressInfo.region, ipAddressInfo.city, ipAddressInfo.zip);
        }
      } else {
        const historicalUser = await db.findUserByHistoricalAddress(requestBody.detailsObject.address);
        if (historicalUser) {
          response.status(409).send("This address was registered previously and cannot be reused.");
          return;
        }
        // const inviter = await db.findUserByInviterCode(requestBody.detailsObject.inviteCode);
        // let inviteeReward = 0;
        // if (inviter && inviter.invitationsRemaining > 0) {
        //   await db.incrementInvitationsAccepted(inviter, INVITER_REWARD);
        //   const rewardRecipient: BankTransactionRecipientDirective = {
        //     address: inviter.address,
        //     portion: "remainder",
        //     reason: "invitation-reward-recipient"
        //   };
        //   const reward: BankTransactionDetails = {
        //     timestamp: null,
        //     address: null,
        //     fingerprint: null,
        //     type: "transfer",
        //     reason: "inviter-reward",
        //     amount: INVITER_REWARD,
        //     relatedCardId: null,
        //     relatedCouponId: null,
        //     toRecipients: [rewardRecipient]
        //   };
        //   await networkEntity.performBankTransaction(request, reward, null, true, false, "Invitation reward", userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint, Date.now());
        //   inviteeReward = INVITEE_REWARD;
        // }
        // const inviteCode = await this.generateInviteCode();
        const initialGrant = await this.getInitialBalanceGrantAppropriate(request, ipAddress, requestBody.detailsObject.fingerprint, isMobile);
        const preferredLangCodes: string[] = ipAddressInfo && ipAddressInfo.countryCode === "US" ? ['en'] : null;
        userRecord = await db.insertUser("normal", requestBody.detailsObject.address, requestBody.detailsObject.publicKey, null, ipAddress, ipAddressInfo ? ipAddressInfo.country : null, ipAddressInfo ? ipAddressInfo.region : null, ipAddressInfo ? ipAddressInfo.city : null, ipAddressInfo ? ipAddressInfo.zip : null, requestBody.detailsObject.referrer, requestBody.detailsObject.landingUrl, null, requestBody.detailsObject.landingCardId, initialGrant, preferredLangCodes);
        if (initialGrant > 0) {
          const grantRecipient: BankTransactionRecipientDirective = {
            address: requestBody.detailsObject.address,
            portion: "remainder",
            reason: "grant-recipient"
          };
          const grant: BankTransactionDetails = {
            timestamp: null,
            address: null,
            fingerprint: null,
            type: "transfer",
            reason: "grant",
            amount: initialGrant,
            relatedCardId: null,
            relatedCouponId: null,
            relatedCardCampaignId: null,
            toRecipients: [grantRecipient]
          };
          await networkEntity.performBankTransaction(request, null, grant, null, "New user grant", userManager.getIpAddressFromRequest(request), requestBody.detailsObject.fingerprint, Date.now());
          userRecord.balance = initialGrant;
        }
      }
      let referringUserId: string;
      if (requestBody.detailsObject.landingUrl) {
        try {
          const landingUrl = new URL(requestBody.detailsObject.landingUrl);
          if (!landingUrl.searchParams) {
            console.warn("User.handleRegisterUser:  landingUrl has no searchParams", requestBody.detailsObject.landingUrl);
          }
          const address = landingUrl && landingUrl.searchParams ? landingUrl.searchParams.get('s') : null;
          if (address) {
            let referringUser = await db.findUserByAddress(address);
            if (referringUser) {
              referringUserId = referringUser.id;
            } else {
              referringUser = await db.findUserByHistoricalAddress(address);
              if (referringUser) {
                referringUserId = referringUser.id;
              }
            }
          }
        } catch (err) {
          errorManager.warning("User.handleRegisterUser: failure processing landingUrl", request, requestBody.detailsObject.landingUrl, err);
        }
      }
      const registrationRecord = await db.insertUserRegistration(userRecord.id, ipAddress, requestBody.detailsObject.fingerprint, isMobile, requestBody.detailsObject.address, requestBody.detailsObject.referrer, requestBody.detailsObject.landingUrl, requestBody.detailsObject.userAgent, referringUserId);
      await db.updateUserSessionId(userRecord.id, registrationRecord.sessionId);
      const userStatus = await this.getUserStatus(request, userRecord, requestBody.sessionId, true);
      const registerResponse: RegisterUserResponse = {
        sessionId: registrationRecord.sessionId,
        serverVersion: SERVER_VERSION,
        status: userStatus,
        id: userRecord.id,
        interestRatePerMillisecond: INTEREST_RATE_PER_MILLISECOND,
        subsidyRate: await priceRegulator.getUserSubsidyRate(),
        operatorTaxFraction: networkEntity.getOperatorTaxFraction(),
        operatorAddress: networkEntity.getOperatorAddress(),
        networkDeveloperRoyaltyFraction: networkEntity.getNetworkDeveloperRoyaltyFraction(),
        networkDeveloperAddress: networkEntity.getNetworkDevelopeAddress(),
        referralFraction: networkEntity.getReferralFraction(),
        withdrawalsEnabled: bank.withdrawalsEnabled,
        depositUrl: configuration.get('braintree.enabled', false) ? this.urlManager.getPublicUrl('deposit') : null,
        admin: userRecord.admin,
        promotionPricing: PROMOTION_PRICING
      };
      response.json(registerResponse);
    } catch (err) {
      errorManager.error("User.handleRegisterUser: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getInitialBalanceGrantAppropriate(request: Request, ipAddress: string, fingerprint: string, isMobile: boolean): Promise<number> {
    // We will deny an initial balance if there is already a user registered who used this fingerprint before.
    // On mobile, we will deny if a user already exists with the same fingerprint and IP address
    if (isMobile && ipAddress) {
      const exists = await db.existsFingerprintAndIpAddress(fingerprint, ipAddress);
      return exists ? 0 : INITIAL_BALANCE;
    } else {
      const exists = await db.existsFingerprint(fingerprint);
      return exists ? 0 : INITIAL_BALANCE;
    }
  }

  getIpAddressFromRequest(request: Request): string {
    if (!request) {
      return null;
    }
    if (configuration.get('ipOverride')) {
      return configuration.get('ipOverride');
    }
    const ipAddressHeader = request.headers['x-forwarded-for'] as string;
    let ipAddress: string;
    if (ipAddressHeader) {
      const ipAddresses = ipAddressHeader.split(',');
      if (ipAddresses.length >= 1 && ipAddresses[0].trim().length > 0) {
        ipAddress = ipAddresses[0].trim();
      }
    } else if (request.ip) {
      ipAddress = request.ip.trim();
    }
    return ipAddress;
  }

  async getGeoFromRequest(request: Request, fingerprint: string): Promise<GeoLocation> {
    const ipAddress = this.getIpAddressFromRequest(request);
    const ipInfo = await this.fetchIpAddressInfo(ipAddress, false);
    return this.getGeoLocationFromIpInfo(fingerprint, ipInfo);
  }

  getGeoLocationFromIpInfo(fingerprint: string, ipInfo: IpAddressRecord): GeoLocation {
    if (!ipInfo) {
      return null;
    }
    const result: GeoLocation = {
      ipAddress: ipInfo.ipAddress,
      fingerprint: fingerprint,
      continentCode: null,
      countryCode: null,
      regionCode: null,
      city: null,
      zipCode: null,
      lat: null,
      lon: null
    };
    if (ipInfo) {
      if (ipInfo.countryCode) {
        result.continentCode = this.getContinentCodeFromCountry(ipInfo.countryCode);
        if (!result.continentCode) {
          errorManager.error("Missing continent mapping for country code", null, ipInfo);
        }
        result.countryCode = ipInfo.countryCode;
      }
      result.regionCode = ipInfo.region;
      result.city = ipInfo.city;
      result.zipCode = ipInfo.zip;
      result.lat = ipInfo.lat;
      result.lon = ipInfo.lon;
    }
    return result;
  }

  private getContinentCodeFromCountry(countryCode: string): string {
    if (!countryCode) {
      return null;
    }
    const info = infoByCountryCode[countryCode];
    return info ? info.continentCode : null;
  }

  async fetchIpAddressInfo(ipAddress: string, force: boolean): Promise<IpAddressRecord> {
    if (!ipAddress) {
      return null;
    }
    if (ipAddress === "::1" || ipAddress === "localhost" || ipAddress === "127.0.0.1") {
      return null;
    }
    let record = this.ipCache.get(ipAddress);
    if (!force && record) {
      return record;
    }
    record = await db.findIpAddress(ipAddress);
    const lifetime = record && record.status === 'success' ? MAX_IP_ADDRESS_LIFETIME : IP_ADDRESS_FAIL_RETRY_INTERVAL;
    if (record && Date.now() - record.lastUpdated < lifetime) {
      this.ipCache.set(ipAddress, record);
      return record;
    }
    if (configuration.get('ipAddress.geo.enabled')) {
      if (record) {
        // Don't wait for response
        void this.initiateIpAddressUpdate(ipAddress, null);
        this.ipCache.set(ipAddress, record);
        return record;
      } else {
        record = await this.initiateIpAddressUpdate(ipAddress, record);
        this.ipCache.set(ipAddress, record);
        return record;
      }
    }
  }

  private async initiateIpAddressUpdate(ipAddress: string, record: IpAddressRecord): Promise<IpAddressRecord> {
    try {
      console.log("User.fetchIpAddressInfo: Fetching geo location for ip " + ipAddress);
      const fetchResponse = await fetch(configuration.get("ipAddress.geo.urlPrefix") + ipAddress + configuration.get("ipAddress.geo.urlSuffix"));
      if (fetchResponse && fetchResponse.status === 200) {
        const json = await fetchResponse.json() as IpApiResponse;
        if (json.status) {
          console.log("User.initiateIpAddressUpdate", ipAddress, json);
          if (record) {
            return db.updateIpAddress(ipAddress, json.status, json.country, json.countryCode, json.region, json.regionName, json.city, json.zip, json.lat, json.lon, json.timezone, json.isp, json.org, json.as, json.query, json.message);
          } else {
            return db.insertIpAddress(ipAddress, json.status, json.country, json.countryCode, json.region, json.regionName, json.city, json.zip, json.lat, json.lon, json.timezone, json.isp, json.org, json.as, json.query, json.message);
          }
        } else {
          errorManager.warning("User.initiateIpAddressUpdate: invalid response from ipapi", null, json);
        }
      } else {
        errorManager.warning("User.initiateIpAddressUpdate: unexpected response from ipapi", null, fetchResponse);
      }
    } catch (err) {
      errorManager.warning("User.initiateIpAddressUpdate: failure fetching IP geo info", null, err);
    }
    return null;
  }

  private async handleSignIn(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as SignInDetails;
      if (!requestBody || !requestBody.handleOrEmailAddress) {
        response.status(400).send("Missing handle/email");
        return;
      }
      console.log("UserManager.register-user", requestBody);
      let user = await this.getUserByHandle(requestBody.handleOrEmailAddress);
      if (!user) {
        user = await db.findUserByEmail(requestBody.handleOrEmailAddress);
      }
      if (!user) {
        response.status(404).send("No user with this handle/email");
        return;
      }
      if (!user.encryptedPrivateKey) {
        response.status(401).send("The password is incorrect or missing.");
        return;
      }
      const reply: SignInResponse = {
        encryptedPrivateKey: user.encryptedPrivateKey
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleSignIn: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  // private async handleRegisterDevice(request: Request, response: Response): Promise<void> {
  //   try {
  //     const requestBody = request.body as RestRequest<RegisterDeviceDetails>;
  //     const user = await RestHelper.validateRegisteredRequest(requestBody, response);
  //     if (!user) {
  //       return;
  //     }
  //     if (!requestBody.detailsObject.token || !requestBody.detailsObject.type) {
  //       response.status(400).send("Device token is missing or invalid");
  //       return;
  //     }
  //     console.log("UserManager.register-device", requestBody.detailsObject.address, requestBody.detailsObject);
  //     const existing = await db.findDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token);
  //     if (existing) {
  //       if (user.address !== existing.userAddress) {
  //         response.status(409).send("This device token is already associated with a different user");
  //         return;
  //       }
  //     } else {
  //       await db.insertDeviceToken(requestBody.detailsObject.type, requestBody.detailsObject.token, requestBody.detailsObject.address);
  //     }
  //     const reply: RegisterDeviceResponse = { success: true };
  //     response.json(reply);
  //   } catch (err) {
  //     errorManager.error("User.handleRegisterDevice: Failure", err);
  //     response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
  //   }
  // }

  private async handleStatus(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UserStatusDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      // console.log("UserManager.status", requestBody.detailsObject.address);
      const status = await this.getUserStatus(request, user, requestBody.sessionId, false);
      const result: UserStatusResponse = {
        serverVersion: SERVER_VERSION,
        status: status
      };
      response.json(result);
    } catch (err) {
      errorManager.error("User.handleStatus: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.identity || !user.identity.handle) {
        if (!requestBody.detailsObject.name || !requestBody.detailsObject.handle) {
          response.status(400).send("Missing name and handle");
          return;
        }
        if (!/^[a-z][a-z0-9\_]{2,22}[a-z0-9]$/i.test(requestBody.detailsObject.handle)) {
          response.status(400).send("Invalid handle.  Must start with letter and can only contain letters, digits and/or underscore.");
          return;
        }
        if (!this.isHandlePermissible(requestBody.detailsObject.handle)) {
          response.status(409).send("This handle is not available");
          return;
        }
      }
      if (requestBody.detailsObject.handle) {
        const existing = await this.getUserByHandle(requestBody.detailsObject.handle);
        if (existing && existing.id !== user.id) {
          response.status(409).send("This handle is not available");
          return;
        }
      }
      if (requestBody.detailsObject.emailAddress) {
        const existing = await db.findUserByEmail(requestBody.detailsObject.emailAddress);
        if (existing && existing.id !== user.id) {
          response.status(409).send("This email address is associated with a different account.");
          return;
        }
      }
      console.log("UserManager.update-identity", requestBody.detailsObject);
      let emailConfirmed: boolean;
      let sendConfirmation = false;
      if (requestBody.detailsObject.emailAddress) {
        if (!user.identity || !user.identity.emailAddress || requestBody.detailsObject.emailAddress !== user.identity.emailAddress) {
          sendConfirmation = true;
          emailConfirmed = false;
        }
      }
      if (!user.identity || !user.identity.handle) {
        await db.incrementNetworkCardStatItems(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
      await db.updateUserIdentity(user, requestBody.detailsObject.name, Utils.getFirstName(requestBody.detailsObject.name), Utils.getLastName(requestBody.detailsObject.name), requestBody.detailsObject.handle, requestBody.detailsObject.imageId, requestBody.detailsObject.location, requestBody.detailsObject.emailAddress, emailConfirmed, requestBody.detailsObject.encryptedPrivateKey);
      await channelManager.ensureUserHomeChannel(user, requestBody.sessionId);
      if (sendConfirmation) {
        void this.sendEmailConfirmation(user);
      }
      if (configuration.get("notifications.userIdentityChange")) {
        let html = "<div>";
        html += "<div>userId: " + user.id + "</div>";
        html += "<div>name: " + requestBody.detailsObject.name + "</div>";
        html += "<div>handle: " + requestBody.detailsObject.handle + "</div>";
        html += "<div>email: " + requestBody.detailsObject.emailAddress ? requestBody.detailsObject.emailAddress : "not specified" + "</div>";
        html += "<div>location: " + requestBody.detailsObject.location ? requestBody.detailsObject.location : "not specified" + "</div>";
        html += "<div>image: " + requestBody.detailsObject.imageId ? '<img style="width:100px;height:auto;" src="' + await fileManager.getFileUrlFromFileId(requestBody.detailsObject.imageId) + '">' : "not specified" + "< /div>";
        html += "</div>";
        void emailManager.sendInternalNotification("User identity added/updated", "A user has added or updated their identity", html);
      }
      await this.announceUserUpdated(user);
      const reply: UpdateUserIdentityResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleUpdateIdentity: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleUpdateAccountSettings(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<UpdateAccountSettingsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!requestBody.detailsObject.settings) {
        response.status(400).send("Missing settings");
        return;
      }
      console.log("UserManager.update-account-settings", requestBody.detailsObject);
      await db.updateUserAccountSettings(user, requestBody.detailsObject.settings.disallowPlatformEmailAnnouncements ? true : false, requestBody.detailsObject.settings.disallowContentEmailAnnouncements ? true : false, requestBody.detailsObject.settings.disallowCommentEmailAnnouncements ? true : false, requestBody.detailsObject.settings.preferredLangCodes);
      await this.announceUserUpdated(user);
      const reply: UpdateAccountSettingsResponse = {
        serverVersion: SERVER_VERSION,
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        image: user.identity ? await fileManager.getFileInfo(user.identity.imageId) : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        emailConfirmed: user.identity && user.identity.emailConfirmed ? true : false,
        encryptedPrivateKey: user.encryptedPrivateKey,
        accountSettings: this.getAccountSettings(user),
        homeChannelId: user.homeChannelId
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleUpdateAccountSettings: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleRequestRecoveryCode(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RequestRecoveryCodeDetails;
      let user: UserRecord;
      if (requestBody.handle) {
        user = await this.getUserByHandle(requestBody.handle);
      } else if (requestBody.emailAddress) {
        user = await db.findUserByEmail(requestBody.emailAddress);
      } else {
        response.status(400).send("You must provide handle or email address");
        return;
      }
      if (!user) {
        response.status(400).send("No matching account found.");
        return;
      }
      if (!user.identity || !user.identity.emailAddress) {
        response.status(409).send("This account does not have a recovery email address associated with it.  There is no way to recover the account if you have forgotten the credentials.");
        return;
      }
      console.log("UserManager.request-recovery-code", requestBody);
      let code: string;
      while (true) {
        code = this.generateRecoveryCode();
        try {
          await db.updateUserRecoveryCode(user, code, Date.now() + RECOVERY_CODE_LIFETIME);
          break;
        } catch (err) {
          // collision on recovery code use, try again
        }
      }
      const text = "Your handle: " + user.identity.handle + "\nRecovery code: " + code + "\n\nEnter this information into the Recover Account page";
      let html = "<p>You asked to recover your Channels account.  Enter the following information into the Account Recovery page.</p>";
      html += "<li>Code: " + code + "</li>";
      html += "<li>Handle: " + user.identity.handle + "</li>";
      html += "<p>If you did not request account recovery, you can safely ignore this message.</p>";
      await emailManager.sendNoReplyUserNotification(user.identity.name, user.identity.emailAddress, "Account recovery", text, html);
      await this.announceUserUpdated(user);
      const reply: RequestRecoveryCodeResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleRequestRecoveryCode: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleRecoverUser(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RecoverUserDetails>;
      const registeredUser = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!registeredUser) {
        return;
      }
      if (registeredUser.identity && registeredUser.identity.handle) {
        response.status(400).send("You can't recover when you have a current identity. Sign out first.");
        return;
      }
      if (!requestBody.detailsObject.code) {
        response.status(400).send("You need to include the code");
        return;
      }
      const user = await db.findUserByRecoveryCode(requestBody.detailsObject.code);
      if (!user) {
        response.status(404).send("This is not a valid code.");
        return;
      }
      if (user.recoveryCodeExpires < Date.now()) {
        response.status(401).send("This code has expired.");
        return;
      }
      if (!user.identity || !user.identity.handle) {
        response.status(401).send("This account is not suitable for recovery.");
        return;
      }
      if (user.identity.handle !== requestBody.detailsObject.handle) {
        response.status(400).send("Handle does not match account.");
        return;
      }
      console.log("UserManager.recover-user", requestBody.detailsObject);
      await db.deleteUser(registeredUser.id);
      await db.updateUserAddress(user, registeredUser.address, registeredUser.publicKey, requestBody.detailsObject.encryptedPrivateKey ? requestBody.detailsObject.encryptedPrivateKey : registeredUser.encryptedPrivateKey);
      await this.announceUserUpdated(registeredUser);
      await this.announceUserUpdated(user);
      const status = await this.getUserStatus(request, user, requestBody.sessionId, true);
      const result: RecoverUserResponse = {
        serverVersion: SERVER_VERSION,
        status: status,
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        image: user.identity ? await fileManager.getFileInfo(user.identity.imageId) : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        emailConfirmed: user.identity && user.identity.emailConfirmed ? true : false,
        encryptedPrivateKey: user.encryptedPrivateKey,
        accountSettings: this.getAccountSettings(user),
        homeChannelId: user.homeChannelId
      };
      response.json(result);
    } catch (err) {
      errorManager.error("User.handleRecoverUser: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private getAccountSettings(user: UserRecord): AccountSettings {
    const result: AccountSettings = {
      disallowPlatformEmailAnnouncements: user.notifications && user.notifications.disallowPlatformNotifications ? true : false,
      disallowContentEmailAnnouncements: user.notifications && user.notifications.disallowContentNotifications ? true : false,
      disallowCommentEmailAnnouncements: user.notifications && user.notifications.disallowCommentNotifications ? true : false,
      preferredLangCodes: user.preferredLangCodes
    };
    return result;
  }

  private async handleGetIdentity(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetUserIdentityDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("UserManager.get-identity", user.id, requestBody.detailsObject);
      const reply: GetUserIdentityResponse = {
        serverVersion: SERVER_VERSION,
        name: user.identity ? user.identity.name : null,
        location: user.identity ? user.identity.location : null,
        image: user.identity ? await fileManager.getFileInfo(user.identity.imageId) : null,
        handle: user.identity ? user.identity.handle : null,
        emailAddress: user.identity ? user.identity.emailAddress : null,
        emailConfirmed: user.identity && user.identity.emailConfirmed ? true : false,
        encryptedPrivateKey: user.encryptedPrivateKey,
        accountSettings: this.getAccountSettings(user),
        homeChannelId: user.homeChannelId
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetIdentity: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetHandle(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetHandleDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const handle = requestBody.detailsObject ? requestBody.detailsObject.handle : null;
      if (!handle) {
        response.status(400).send("Missing handle");
        return;
      }
      console.log("UserManager.get-handle", user.id, requestBody.detailsObject);
      const found = await this.getUserByHandle(handle);
      if (!found) {
        response.status(404).send("Handle not found");
        return;
      }
      const reply: GetHandleResponse = {
        serverVersion: SERVER_VERSION,
        handle: found.identity ? found.identity.handle : null,
        name: found.identity ? found.identity.name : null,
        image: found.identity ? await fileManager.getFileInfo(found.identity.imageId) : null
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetHandle: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetGeoDescriptors(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetGeoDescriptorsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("UserManager.get-geo-descriptors", user.id, requestBody.detailsObject);
      const reply: GetGeoDescriptorsResponse = {
        serverVersion: SERVER_VERSION,
        continents: null,
        countriesByContinent: null,
        regionsByCountry: null
      };
      if (requestBody.detailsObject.countryCode) {
        reply.regionsByCountry = {};
        reply.regionsByCountry[requestBody.detailsObject.countryCode] = [];
        const regions = await this.getRegionsByCountry(requestBody.detailsObject.countryCode);
        for (const region of regions) {
          reply.regionsByCountry[requestBody.detailsObject.countryCode].push(region);
        }
      } else {
        reply.continents = [];
        for (const continentCode of Object.keys(continentNameByContinentCode)) {
          reply.continents.push({ code: continentCode, name: continentNameByContinentCode[continentCode] });
        }
        reply.countriesByContinent = {};
        for (const countryCode of Object.keys(infoByCountryCode)) {
          const countryInfo = infoByCountryCode[countryCode];
          if (!reply.countriesByContinent[countryInfo.continentCode]) {
            reply.countriesByContinent[countryInfo.continentCode] = [];
          }
          reply.countriesByContinent[countryInfo.continentCode].push({ code: countryCode, name: countryInfo.name });
        }
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetGeoDescriptors: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleGetCommunityInfo(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetCommunityInfoDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const maxCount = requestBody.detailsObject.maxCount || 10;
      console.log("UserManager.get-community-info", user.id, requestBody.detailsObject);
      const reply: GetCommunityInfoResponse = {
        serverVersion: SERVER_VERSION,
        networkHelpers: await this.getNetworkCommunityInfo(request, user, "networkHelpers", maxCount, null),
        myHelpers: await this.getMyHelpersCommunityInfo(request, user, "myHelpers", maxCount, null),
        helpedByMe: await this.getHelpedByMeCommunityInfo(request, user, "helpedByMe", maxCount, null),
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetCommunityInfo: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async getNetworkCommunityInfo(request: Request, user: UserRecord, type: CommunityInfoListType, maxCount: number, afterUserId: string): Promise<CommunityMemberInfo[]> {
    const result: CommunityMemberInfo[] = [];
    const cursor = db.aggregateAuthorUsersReferrals();
    let waiting = afterUserId ? true : false;
    while (result.length < maxCount) {
      const item = await cursor.next();
      if (!item) {
        break;
      }
      if (waiting) {
        if (item.userId === afterUserId) {
          waiting = false;
        }
        continue;
      }
      const referrer = await userManager.getUserDescriptor(item.userId, false);
      if (!referrer.handle || referrer.blocked) {
        continue;
      }
      const resultItem: CommunityMemberInfo = {
        user: referrer,
        authors: item.authorIds.length - (item.authorIds.indexOf(item.userId) >= 0 ? 1 : 0),
        referredCards: item.referredCards,
        referredPurchases: item.referredPurchases
      };
      result.push(resultItem);
    }
    await cursor.close();
    return result;
  }

  private async getMyHelpersCommunityInfo(request: Request, user: UserRecord, type: CommunityInfoListType, maxCount: number, afterUserId: string): Promise<CommunityMemberInfo[]> {
    const result: CommunityMemberInfo[] = [];
    const cursor = db.getAuthorUsersByAuthor(user.id);
    let waiting = afterUserId ? true : false;
    while (await cursor.hasNext() && result.length < maxCount) {
      const authorUser = await cursor.next();
      if (waiting) {
        if (authorUser.userId === afterUserId) {
          waiting = false;
        }
        continue;
      }
      if (authorUser.userId === user.id) {
        continue;
      }
      if (authorUser.stats.referredPurchases === 0) {
        break;
      }
      const referrer = await userManager.getUserDescriptor(authorUser.userId, false);
      if (!referrer.handle || referrer.blocked) {
        continue;
      }
      const resultItem: CommunityMemberInfo = {
        user: referrer,
        authors: 1,
        referredCards: authorUser.stats.referredCards,
        referredPurchases: authorUser.stats.referredPurchases
      };
      result.push(resultItem);
    }
    await cursor.close();
    return result;
  }

  private async getHelpedByMeCommunityInfo(request: Request, user: UserRecord, type: CommunityInfoListType, maxCount: number, afterUserId: string): Promise<CommunityMemberInfo[]> {
    const result: CommunityMemberInfo[] = [];
    const cursor = db.getAuthorUsersByUser(user.id);
    let waiting = afterUserId ? true : false;
    while (await cursor.hasNext() && result.length < maxCount) {
      const authorUser = await cursor.next();
      if (waiting) {
        if (authorUser.authorId === afterUserId) {
          waiting = false;
        }
        continue;
      }
      if (authorUser.authorId === user.id) {
        continue;
      }
      if (authorUser.stats.referredPurchases === 0) {
        break;
      }
      const referrer = await userManager.getUserDescriptor(authorUser.authorId, false);
      if (!referrer.handle || referrer.blocked) {
        continue;
      }
      const resultItem: CommunityMemberInfo = {
        user: referrer,
        authors: 1,
        referredCards: authorUser.stats.referredCards,
        referredPurchases: authorUser.stats.referredPurchases
      };
      result.push(resultItem);
    }
    await cursor.close();
    return result;
  }

  private async handleGetCommunityInfoMore(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<GetCommunityInfoMoreDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      const maxCount = requestBody.detailsObject.maxCount || 10;
      const sinceUserId = requestBody.detailsObject.afterUserId;
      const type = requestBody.detailsObject.list;
      console.log("UserManager.get-community-info-more", user.id, requestBody.detailsObject);
      let info: CommunityMemberInfo[];
      switch (type) {
        case "networkHelpers":
          info = await this.getNetworkCommunityInfo(request, user, type, maxCount, sinceUserId);
          break;
        case "myHelpers":
          info = await this.getMyHelpersCommunityInfo(request, user, type, maxCount, sinceUserId);
          break;
        case "helpedByMe":
          info = await this.getHelpedByMeCommunityInfo(request, user, type, maxCount, sinceUserId);
          break;
        default:
          response.status(400).send("Invalid list type " + type);
      }
      const reply: GetCommunityInfoMoreResponse = {
        serverVersion: SERVER_VERSION,
        members: info
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleGetCommunityInfoMore: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleRequestEmailConfirmation(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<RequestEmailConfirmationDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      console.log("UserManager.request-email-confirmation", user.id, requestBody.detailsObject);
      if (!user.identity || !user.identity.emailAddress) {
        response.status(409).send("User has no email address to confirm");
        return;
      }
      await this.sendEmailConfirmation(user);
      const reply: RequestEmailConfirmationResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleRequestEmailConfirmation: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleConfirmEmail(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<ConfirmEmailDetails>;
      requestBody.detailsObject = JSON.parse(requestBody.details) as ConfirmEmailDetails;
      const confirmationCode = requestBody.detailsObject ? requestBody.detailsObject.code : null;
      if (!confirmationCode) {
        response.status(400).send("Missing code");
        return;
      }
      console.log("UserManager.confirm-email", requestBody.detailsObject);
      const user = await db.findUserByEmailConfirmationCode(confirmationCode);
      if (!user) {
        response.status(404).send("No such user");
        return;
      }
      if (!user.identity || !user.identity.emailAddress) {
        response.status(409).send("User has no email address to confirm");
        return;
      }
      const firstConfirmation = user.identity.emailLastConfirmed ? false : true;
      await db.updateUserEmailConfirmation(user);
      if (firstConfirmation) {
        await channelManager.payReferralBonusIfAppropriate(user);
        await this.payRegistrationBonus(request, user, requestBody.detailsObject.fingerprint);
      }
      await this.announceUserUpdated(user);
      const status = await this.getUserStatus(request, user, requestBody.sessionId, true);
      const reply: ConfirmEmailResponse = {
        serverVersion: SERVER_VERSION,
        userId: user.id,
        handle: user.identity.handle,
        status: status
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleConfirmEmail: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async payRegistrationBonus(request: Request, user: UserRecord, fingerprint: string): Promise<void> {
    if (user.balance > 2.51) {
      return;
    }
    const grantRecipient: BankTransactionRecipientDirective = {
      address: user.address,
      portion: "remainder",
      reason: "registration-bonus"
    };
    const grant: BankTransactionDetails = {
      timestamp: null,
      address: null,
      fingerprint: null,
      type: "transfer",
      reason: "registration-bonus",
      amount: REGISTRATION_BONUS,
      relatedCardId: null,
      relatedCouponId: null,
      relatedCardCampaignId: null,
      toRecipients: [grantRecipient]
    };
    await networkEntity.performBankTransaction(request, null, grant, null, "Registration bonus", userManager.getIpAddressFromRequest(request), fingerprint, Date.now());
    user.balance += REGISTRATION_BONUS;
    console.log("User.payRegistrationBonus: granting user bonus for confirming email", user.identity.handle);
  }

  private async handleAdminGetUsers(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetUsersDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const users = requestBody.detailsObject.withIdentityOnly ? await db.findUsersWithIdentity(requestBody.detailsObject.limit) : await db.findUsersByLastContact(requestBody.detailsObject.limit);
      console.log("UserManager.admin-get-users", user.id, requestBody.detailsObject);
      const usersWithData: AdminUserInfo[] = [];
      for (const userInfo of users) {
        const cursor = db.getCardsByUserAndTime(0, 0, userInfo.id, false, false, false);
        const totalPosts = await cursor.count();
        let count = 0;
        let privateCards = 0;
        let cardRevenue = 0;
        let cardsDeleted = 0;
        while (await cursor.hasNext()) {
          const card = await cursor.next();
          privateCards += card.private ? 1 : 0;
          cardRevenue += card.stats.revenue.value;
          if (card.state !== 'active') {
            cardsDeleted++;
          }
          if (count++ > 500) {
            break;
          }
        }
        let cardsBought = 0;
        let cardsOpened = 0;
        const userCards = await db.findUserCardInfoForUser(userInfo.id);
        for (const userCard of userCards) {
          if (userCard.lastOpened && userCard.lastOpened > 0) {
            cardsOpened++;
          }
          if (userCard.paidToAuthor && userCard.paidToAuthor > 0) {
            cardsBought++;
          }
        }
        const cardsSold = await this.countUserPaidOpens(userInfo, 0, Date.now());
        const item: AdminUserInfo = {
          user: userInfo,
          cardsPosted: totalPosts,
          privateCards: privateCards,
          cardRevenue: cardRevenue,
          cardsBought: cardsBought,
          cardsOpened: cardsOpened,
          cardsSold: cardsSold,
          cardsDeleted: cardsDeleted
        };
        usersWithData.push(item);
      }
      const reply: AdminGetUsersResponse = {
        serverVersion: SERVER_VERSION,
        users: usersWithData
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminGetUsers: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleAdminGetReferrals(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminGetAuthorUserStatsDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const items: AuthorUserAggregationAdminItem[] = [];
      const cursor = db.aggregateAuthorUserReferralsAdmin();
      while (items.length < 200) {
        const item = await cursor.next();
        if (!item) {
          break;
        }
        items.push(item);
      }
      await cursor.close();
      console.log("UserManager.admin-get-referrals", user.id, requestBody.detailsObject);
      const reply: AdminGetAuthorUserStatsResponse = {
        serverVersion: SERVER_VERSION,
        items: items
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminGetReferrals: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleAdminSetUserMailingList(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminSetUserMailingListDetails>;
      const user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!user) {
        return;
      }
      if (!user.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const mailingListUser = await this.getUser(requestBody.detailsObject.userId, true);
      if (!mailingListUser) {
        response.status(404).send("No such user");
        return;
      }
      await db.updateUserMailingList(mailingListUser, requestBody.detailsObject.mailingList ? true : false);
      console.log("UserManager.admin-set-user-mailing-list", user.id, requestBody.detailsObject);
      const reply: AdminSetUserMailingListResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminSetUserMailingList: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async handleAdminSetUserCuration(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<AdminSetUserCurationDetails>;
      const admin = await RestHelper.validateRegisteredRequest(requestBody, request, response);
      if (!admin) {
        return;
      }
      if (!admin.admin) {
        response.status(403).send("You are not an admin");
        return;
      }
      const user = await this.getUser(requestBody.detailsObject.userId, true);
      if (!user) {
        response.status(404).send("No such user");
        return;
      }
      console.log("UserManager.admin-set-user-mailing-list", user.id, requestBody.detailsObject);
      if (requestBody.detailsObject.curation !== user.curation && requestBody.detailsObject.curation === "blocked") {
        const yesterday = Date.now() - 1000 * 60 * 60 * 24;
        const oldPaidOpens = await this.countUserPaidOpens(user, 0, yesterday);
        if (oldPaidOpens > 0) {
          const oldRecord = await db.getNetworkCardStatsAt(yesterday);
          if (oldRecord) {
            await db.incrementNetworkCardStatBlockedOpens(oldRecord.periodStarting, oldPaidOpens);
          }
        }
        const todayPaidOpens = await this.countUserPaidOpens(user, yesterday, Date.now());
        if (todayPaidOpens) {
          await db.incrementNetworkCardStatItems(0, 0, 0, 0, 0, 0, 0, 0, todayPaidOpens, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
      }
      if (requestBody.detailsObject.curation === 'blocked') {
        await db.updateCardsBlockedByAuthor(user.id, true);
      } else if (requestBody.detailsObject.curation === 'discounted') {
        await db.updateCardsLastScoredByAuthor(user.id, true);
      }
      await db.updateUserCuration(user.id, requestBody.detailsObject.curation);
      if (requestBody.detailsObject.curation === "blocked") {
        await db.updateCardCommentCurationForUser(user.id, "blocked");
      }
      await this.announceUserUpdated(user);
      const reply: AdminSetUserCurationResponse = {
        serverVersion: SERVER_VERSION
      };
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleAdminSetUserCuration: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  private async countUserPaidOpens(user: UserRecord, from: number, to: number): Promise<number> {
    const cursor = db.getCardsByAuthor(user.id);
    let result = 0;
    while (await cursor.hasNext()) {
      const card = await cursor.next();
      result += await db.countCardPayments(card.id, from, to);
    }
    await cursor.close();
    return result;
  }

  private async handleCheckHandle(request: Request, response: Response): Promise<void> {
    try {
      const requestBody = request.body as RestRequest<CheckHandleDetails>;
      let user: UserRecord;
      if (requestBody.signature) {
        user = await RestHelper.validateRegisteredRequest(requestBody, request, response);
        if (!user) {
          return;
        }
      } else {
        requestBody.detailsObject = JSON.parse(requestBody.details);
      }
      if (!requestBody.detailsObject.handle) {
        response.status(400).send("Missing handle");
        return;
      }
      const reply: CheckHandleResponse = {
        serverVersion: SERVER_VERSION,
        valid: false,
        inUse: false
      };
      if (!/^[a-z][a-z0-9\_]{2,22}[a-z0-9]$/i.test(requestBody.detailsObject.handle)) {
        response.json(reply);
        return;
      }
      reply.valid = true;
      console.log("UserManager.check-handle", requestBody.details);
      const existing = await this.getUserByHandle(requestBody.detailsObject.handle);
      if (existing) {
        if (!user || existing.id !== user.id) {
          reply.inUse = true;
          response.json(reply);
          return;
        }
      }
      response.json(reply);
    } catch (err) {
      errorManager.error("User.handleCheckHandle: Failure", request, err);
      response.status(err.code ? err.code : 500).send(err.message ? err.message : err);
    }
  }

  async getUserStatus(request: Request, user: UserRecord, sessionId: string, updateBalance: boolean): Promise<UserStatus> {
    if (updateBalance) {
      await this.updateUserBalance(request, user, sessionId);
    }
    const network = await db.getNetwork();
    let timeUntilNextAllowedWithdrawal = 0;
    if (user.lastWithdrawal) {
      timeUntilNextAllowedWithdrawal = Math.max(0, MINIMUM_WITHDRAWAL_INTERVAL - (Date.now() - user.lastWithdrawal));
    }
    const result: UserStatus = {
      goLive: this.goLiveDate,
      initialBalance: typeof user.initialBalance === 'number' ? user.initialBalance : 1,
      userBalance: user.balance,
      userBalanceAt: user.balanceLastUpdated,
      minBalanceAfterWithdrawal: MINIMUM_BALANCE_AFTER_WITHDRAWAL,
      targetBalance: TARGET_BALANCE,
      cardBasePrice: await priceRegulator.getBaseCardFee(),
      totalPublisherRevenue: network.totalPublisherRevenue,
      totalCardDeveloperRevenue: network.totalCardDeveloperRevenue,
      publisherSubsidies: await networkEntity.getPublisherSubsidies(),
      timeUntilNextAllowedWithdrawal: timeUntilNextAllowedWithdrawal,
      firstCardPurchasedId: user.firstCardPurchasedId,
      lastLanguagePublished: user.lastLanguagePublished
    };
    return result;
  }

  async generateInviteCode(): Promise<string> {
    while (true) {
      let result = '';
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      result += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
      const existing = await db.findUserByInviterCode(result);
      if (!existing) {
        return result;
      }
    }
  }

  private generateRecoveryCode(): string {
    let result = '';
    result += NON_ZERO_DIGITS[Math.floor(Math.random() * NON_ZERO_DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)];
    return result;
  }

  private isHandlePermissible(handle: string): boolean {
    return BAD_WORDS.indexOf(handle.toLowerCase()) < 0;
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    console.log("User.Poll", now);
    const cursor = db.getUsersForBalanceUpdates(Date.now() - BALANCE_UPDATE_INTERVAL, Date.now() - BALANCE_DORMANT_ACCOUNT_INTERVAL);
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      await this.updateUserBalance(null, user, null);
    }
    await cursor.close();

    console.log("User.Poll (debug):  about to getStaleUsers");
    const staleCursor = db.getStaleUsers(Date.now() - STALE_USER_INTERVAL);
    console.log("User.Poll (debug):  about to count()");
    const cursorCount = await staleCursor.count();
    console.log("User.Poll (debug):  stale users: " + cursorCount, now);
    let count = 0;
    const hasNext = await staleCursor.hasNext();
    console.log("User.poll (debug): hasNext: " + hasNext);
    while (await staleCursor.hasNext()) {
      console.log("User.poll: next ...");
      const user = await staleCursor.next();
      console.log("User.poll: Removing stale user (" + (count++) + ")", user.id, user.added);
      await db.removeBankTransactionRecordsByReason(user.id, "interest");
      console.log("User.poll: Removing stale user registrations", user.id, user.added);
      await db.removeUserRegistrations(user.id);
      console.log("User.poll: Removing user", user.id, user.added);
      await db.removeUser(user.id);
      console.log("User.poll: User removed", user.id, user.added);
      if (count > MAX_STALE_USERS_PER_CYCLE) {
        break;
      }
    }
    console.log("User.poll: about to close");
    await staleCursor.close();
    console.log("User.Poll: finished", Date.now() - now);
  }

  async updateUserBalance(request: Request, user: UserRecord, sessionId: string): Promise<void> {
    const now = Date.now();
    let subsidy = 0;
    let balanceBelowTarget = false;
    if (user.balanceBelowTarget) {
      const subsidyRate = await priceRegulator.getUserSubsidyRate();
      subsidy = (now - user.balanceLastUpdated) * subsidyRate;
      if (TARGET_BALANCE > user.balance + subsidy) {
        balanceBelowTarget = true;
      } else {
        subsidy = Math.min(subsidy, TARGET_BALANCE - user.balance);
      }
      if (subsidy > 0) {
        const subsidyRecipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "subsidy-recipient"
        };
        const subsidyDetails: BankTransactionDetails = {
          timestamp: null,
          address: null,
          fingerprint: null,
          type: "transfer",
          reason: "subsidy",
          amount: subsidy,
          relatedCardId: null,
          relatedCouponId: null,
          relatedCardCampaignId: null,
          toRecipients: [subsidyRecipient]
        };
        await networkEntity.performBankTransaction(request, sessionId, subsidyDetails, null, "User subsidy", null, null, Date.now());
        await priceRegulator.onUserSubsidyPaid(subsidy);
      }
    }
    if (now - user.balanceLastUpdated > MIN_INTEREST_INTERVAL) {
      const interest = this.calculateInterestBetween(user.balanceLastUpdated, now, user.balance);
      if (interest > 0) {
        const interestRecipient: BankTransactionRecipientDirective = {
          address: user.address,
          portion: "remainder",
          reason: "interest-recipient"
        };
        const grant: BankTransactionDetails = {
          timestamp: null,
          address: null,
          fingerprint: null,
          type: "transfer",
          reason: "interest",
          amount: interest,
          relatedCardId: null,
          relatedCouponId: null,
          relatedCardCampaignId: null,
          toRecipients: [interestRecipient]
        };
        await networkEntity.performBankTransaction(request, sessionId, grant, null, "Interest", null, null, now);
      }
    }
  }

  private calculateInterestBetween(from: number, to: number, balance: number): number {
    if (from === 0) {
      return 0;
    }
    return (to - from) * balance * INTEREST_RATE_PER_MILLISECOND;
  }

  async onUserSocketMessage(address: string): Promise<UserRecord> {
    const user = await this.getUserByAddress(address);
    if (!user) {
      return null;
    }
    await db.updateLastUserContact(user, Date.now());
    return user;
  }

  isUserAddress(user: UserRecord, address: string): boolean {
    if (user.address === address) {
      return true;
    }
    for (const a of user.addressHistory) {
      if (a.address === address) {
        return true;
      }
    }
    return false;
  }

  async getUserDescriptor(userId: string, includePublicKey: boolean): Promise<UserDescriptor> {
    const user = await this.getUser(userId, false);
    if (!user) {
      return null;
    }
    const result: UserDescriptor = {
      id: user.id,
      address: user.address,
      handle: user.identity ? user.identity.handle : null,
      publicKey: user.publicKey,
      name: user.identity ? user.identity.name : null,
      image: user.identity && user.identity.imageId ? await fileManager.getFileInfo(user.identity.imageId) : (user.identity ? { id: null, imageInfo: null, url: user.identity.imageUrl } : null),
      location: user.identity ? user.identity.location : null,
      memberSince: user.added,
      blocked: user.curation === "blocked"
    };
    return result;
  }

  async sendEmailConfirmation(user: UserRecord): Promise<void> {
    console.log("User.sendEmailConfirmation", user.identity.handle, user.identity.emailAddress);
    if (!user.identity || !user.identity.emailAddress) {
      throw new Error("User does not have an email address to confirm.");
    }
    const confirmationCode = uuid.v4();
    await db.updateUserEmailConfirmationCode(user, confirmationCode);
    const info: any = {};
    const button: EmailButton = {
      caption: "Confirm",
      url: this.urlManager.getAbsoluteUrl('/confirm-email?code=' + encodeURIComponent(confirmationCode))
    };
    const buttons: EmailButton[] = [button];
    await emailManager.sendUsingTemplate("Channels email verification", "no-reply@channels.cc", user.identity.name, user.identity.emailAddress, "Confirm your email address", "email-confirmation", info, buttons);
  }

  async isMultiuserFromSameBrowser(user: UserRecord): Promise<boolean> {
    const fingerprints = await db.findUserRegistrationDistinctFingerprints(user.id);
    const filtered: string[] = [];
    const userIds = await db.findUserIdsByFingerprint(fingerprints);
    const users = await db.findUsersWithIdentityAmong(userIds, 10);
    if (users.length > 1) {
      return true;
    }
    if (users.length === 1) {
      return users[0].id !== user.id;
    }
    return false;
  }

  async adminBlockUser(user: UserRecord): Promise<void> {
    await db.updateUserCuration(user.id, "blocked");
    await db.updateCardsBlockedByAuthor(user.id, true);
    await this.announceUserUpdated(user);
  }

  async getGeoTargetDescriptors(targets: string[]): Promise<GeoTargetDescriptor[]> {
    const result: GeoTargetDescriptor[] = [];
    if (targets) {
      for (const target of targets) {
        const parts = target.split('.');
        const item: GeoTargetDescriptor = {
          continentCode: null,
          continentName: null,
        };
        if (parts.length > 0) {
          item.continentCode = parts[0];
          item.continentName = continentNameByContinentCode[item.continentCode];
        }
        if (parts.length > 1) {
          const subparts = parts[1].split(/[\.\:]/);
          item.countryCode = subparts[0];
          const info = infoByCountryCode[item.countryCode];
          if (info) {
            item.countryName = info.name;
          }
          if (subparts.length > 1) {
            if (parts[1].indexOf(':') >= 0) {
              item.zipCode = subparts[1];
            } else {
              item.regionCode = subparts[1];
              item.regionName = await this.getRegionNameByCode(item.countryCode, item.regionCode);
            }
          }
        }
      }
    }
    return result;
  }

  private async getRegionsByCountry(countryCode: string): Promise<CodeAndName[]> {
    let result = this.countryRegionsCache.get(countryCode);
    if (!result) {
      result = [];
      const regionCodes = await db.findIpAddressDistinctRegions(countryCode);
      for (const regionCode of regionCodes) {
        if (regionCode) {
          const record = await db.findIpAddressRegionCode(countryCode, regionCode);
          if (record) {
            result.push({ code: regionCode, name: record.regionName });
          }
        }
      }
      this.countryRegionsCache.set(countryCode, result);
    }
    return result;
  }

  private async getRegionNameByCode(countryCode: string, regionCode: string): Promise<string> {
    const key = countryCode + "." + regionCode;
    const result = this.countryCache.get(key);
    if (result) {
      return result;
    }
    const ipInfo = await db.findIpAddressRegionCode(countryCode, regionCode);
    if (ipInfo) {
      this.regionCache.set(key, ipInfo.regionName);
      return ipInfo.regionName;
    } else {
      return null;
    }
  }
}

const BAD_WORDS: string[] = ["4r5e",
  "a55",
  "anal",
  "anus",
  "ar5e",
  "arrse",
  "arse",
  "ass",
  "ass_fucker",
  "asses",
  "assfucker",
  "assfukka",
  "asshole",
  "assholes",
  "asswhole",
  "a_s_s",
  "b1tch",
  "ballbag",
  "balls",
  "ballsack",
  "bastard",
  "beastial",
  "beastiality",
  "bellend",
  "bestial",
  "bestiality",
  "biatch",
  "bitch",
  "bitcher",
  "bitchers",
  "bitches",
  "bitchin",
  "bitching",
  "bloody",
  "blow job",
  "blowjob",
  "blowjobs",
  "boiolas",
  "bollock",
  "bollok",
  "boner",
  "boob",
  "boobs",
  "booobs",
  "boooobs",
  "booooobs",
  "booooooobs",
  "breasts",
  "buceta",
  "bugger",
  "bum",
  "bunny fucker",
  "butt",
  "butthole",
  "buttmuch",
  "buttplug",
  "carpet muncher",
  "cawk",
  "chink",
  "cipa",
  "cl1t",
  "clit",
  "clitoris",
  "clits",
  "cnut",
  "cock",
  "cock_sucker",
  "cockface",
  "cockhead",
  "cockmunch",
  "cockmuncher",
  "cocks",
  "cocksuck ",
  "cocksucked ",
  "cocksucker",
  "cocksucking",
  "cocksucks ",
  "cocksuka",
  "cocksukka",
  "cok",
  "cokmuncher",
  "coksucka",
  "coon",
  "cox",
  "crap",
  "cum",
  "cummer",
  "cumming",
  "cums",
  "cumshot",
  "cunilingus",
  "cunillingus",
  "cunnilingus",
  "cunt",
  "cuntlick ",
  "cuntlicker ",
  "cuntlicking ",
  "cunts",
  "cyalis",
  "cyberfuc",
  "cyberfuck ",
  "cyberfucked ",
  "cyberfucker",
  "cyberfuckers",
  "cyberfucking ",
  "d1ck",
  "damn",
  "dick",
  "dickhead",
  "dildo",
  "dildos",
  "dink",
  "dinks",
  "dirsa",
  "dlck",
  "dog_fucker",
  "doggin",
  "dogging",
  "donkeyribber",
  "doosh",
  "duche",
  "dyke",
  "ejaculate",
  "ejaculated",
  "ejaculates ",
  "ejaculating ",
  "ejaculatings",
  "ejaculation",
  "ejakulate",
  "f4nny",
  "fag",
  "fagging",
  "faggitt",
  "faggot",
  "faggs",
  "fagot",
  "fagots",
  "fags",
  "fanny",
  "fannyflaps",
  "fannyfucker",
  "fanyy",
  "fatass",
  "fcuk",
  "fcuker",
  "fcuking",
  "feck",
  "fecker",
  "felching",
  "fellate",
  "fellatio",
  "fingerfuck ",
  "fingerfucked ",
  "fingerfucker ",
  "fingerfuckers",
  "fingerfucking ",
  "fingerfucks ",
  "fistfuck",
  "fistfucked ",
  "fistfucker ",
  "fistfuckers ",
  "fistfucking ",
  "fistfuckings ",
  "fistfucks ",
  "flange",
  "fook",
  "fooker",
  "fuck",
  "fucka",
  "fucked",
  "fucker",
  "fuckers",
  "fuckhead",
  "fuckheads",
  "fuckin",
  "fucking",
  "fuckings",
  "fuckingshitmotherfucker",
  "fuckme ",
  "fucks",
  "fuckwhit",
  "fuckwit",
  "fuckyou",
  "fuck_you",
  "fudge packer",
  "fudgepacker",
  "fuk",
  "fuker",
  "fukker",
  "fukkin",
  "fuks",
  "fukwhit",
  "fukwit",
  "fux",
  "fux0r",
  "f_u_c_k",
  "gangbang",
  "gangbanged ",
  "gangbangs ",
  "gaylord",
  "gaysex",
  "goatse",
  "God",
  "god_dam",
  "god_damned",
  "goddamn",
  "goddamned",
  "hardcoresex ",
  "hell",
  "heshe",
  "hoar",
  "hoare",
  "hoer",
  "homo",
  "hore",
  "horniest",
  "horny",
  "hotsex",
  "jack_off ",
  "jackoff",
  "jap",
  "jerk_off ",
  "jism",
  "jiz ",
  "jizm ",
  "jizz",
  "kawk",
  "knob",
  "knobead",
  "knobed",
  "knobend",
  "knobhead",
  "knobjocky",
  "knobjokey",
  "kock",
  "kondum",
  "kondums",
  "kum",
  "kummer",
  "kumming",
  "kums",
  "kunilingus",
  "l3itch",
  "labia",
  "lmfao",
  "lust",
  "lusting",
  "m45terbate",
  "ma5terb8",
  "ma5terbate",
  "masochist",
  "master_bate",
  "masterb8",
  "masterbat*",
  "masterbat3",
  "masterbate",
  "masterbation",
  "masterbations",
  "masturbate",
  "mo_fo",
  "mof0",
  "mofo",
  "mothafuck",
  "mothafucka",
  "mothafuckas",
  "mothafuckaz",
  "mothafucked ",
  "mothafucker",
  "mothafuckers",
  "mothafuckin",
  "mothafucking ",
  "mothafuckings",
  "mothafucks",
  "mother fucker",
  "motherfuck",
  "motherfucked",
  "motherfucker",
  "motherfuckers",
  "motherfuckin",
  "motherfucking",
  "motherfuckings",
  "motherfuckka",
  "motherfucks",
  "muff",
  "mutha",
  "muthafecker",
  "muthafuckker",
  "muther",
  "mutherfucker",
  "n1gga",
  "n1gger",
  "nazi",
  "nigg3r",
  "nigg4h",
  "nigga",
  "niggah",
  "niggas",
  "niggaz",
  "nigger",
  "niggers ",
  "nob",
  "nob jokey",
  "nobhead",
  "nobjocky",
  "nobjokey",
  "numbnuts",
  "nutsack",
  "orgasim ",
  "orgasims ",
  "orgasm",
  "orgasms ",
  "p0rn",
  "pawn",
  "pecker",
  "penis",
  "penisfucker",
  "phonesex",
  "phuck",
  "phuk",
  "phuked",
  "phuking",
  "phukked",
  "phukking",
  "phuks",
  "phuq",
  "pigfucker",
  "pimpis",
  "piss",
  "pissed",
  "pisser",
  "pissers",
  "pisses ",
  "pissflaps",
  "pissin ",
  "pissing",
  "pissoff ",
  "poop",
  "porn",
  "porno",
  "pornography",
  "pornos",
  "prick",
  "pricks ",
  "pron",
  "pube",
  "pusse",
  "pussi",
  "pussies",
  "pussy",
  "pussys ",
  "rectum",
  "retard",
  "rimjaw",
  "rimming",
  "sadist",
  "schlong",
  "screwing",
  "scroat",
  "scrote",
  "scrotum",
  "semen",
  "sex",
  "sh1t",
  "shag",
  "shagger",
  "shaggin",
  "shagging",
  "shemale",
  "shit",
  "shitdick",
  "shite",
  "shited",
  "shitey",
  "shitfuck",
  "shitfull",
  "shithead",
  "shiting",
  "shitings",
  "shits",
  "shitted",
  "shitter",
  "shitters ",
  "shitting",
  "shittings",
  "shitty ",
  "skank",
  "slut",
  "sluts",
  "smegma",
  "smut",
  "snatch",
  "son_of_a_bitch",
  "spac",
  "spunk",
  "s_h_i_t",
  "t1tt1e5",
  "t1tties",
  "teets",
  "teez",
  "testical",
  "testicle",
  "tit",
  "titfuck",
  "tits",
  "titt",
  "tittie5",
  "tittiefucker",
  "titties",
  "tittyfuck",
  "tittywank",
  "titwank",
  "tosser",
  "turd",
  "tw4t",
  "twat",
  "twathead",
  "twatty",
  "twunt",
  "twunter",
  "v14gra",
  "v1gra",
  "vagina",
  "viagra",
  "vulva",
  "w00se",
  "wang",
  "wank",
  "wanker",
  "wanky",
  "whoar",
  "whore",
  "willies",
  "willy",
  "xrated",
  "xxx"
];

const userManager = new UserManager();

export { userManager };

interface IpApiResponse {
  status: IpAddressStatus;
  country: string;
  countryCode: string;
  region: string;
  regionName: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  timezone: string;
  isp: string;
  org: string;
  "as": string;
  query: string;
  message: string;
}

interface CountryInfo {
  continentCode: string;
  name: string;
}
