
import { UrlManager } from "../url-manager";

export interface Initializable {
  initialize(urlManager: UrlManager): Promise<void>;
  initialize2(): Promise<void>;
}
