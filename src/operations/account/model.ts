import type {
  ProductCatalog,
  ProductSearchLocale,
  ProductSearchResult,
} from "../../catalog/product-catalog";
import type { EconomyDirectory } from "../../economy/economy-directory";
import type { Clock } from "../store/internal";
import type {
  Account,
  AccountId,
  ConfirmedProduct,
  ProductRef,
} from "../store/model";
import type { OperationalStore } from "../store/operational-store";

export interface AccountServiceOptions {
  readonly store: OperationalStore;
  readonly economyDirectory: EconomyDirectory;
  readonly productCatalog: ProductCatalog;
  readonly economyAnalysisBuildId: string;
  readonly productSearchBuildId: string;
  readonly clock?: Clock;
}

export interface RegisterAccountInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly primaryExportEconomy: string;
}

export interface AccountRegistration {
  readonly account: Account;
}

export interface AuthenticateInput {
  readonly email: string;
  readonly password: string;
  readonly sessionDurationSeconds?: number;
}

export interface AuthenticatedSession {
  readonly account: Account;
  readonly sessionToken: string;
  readonly expiresAt: string;
}

export interface IssueRecoveryTokenInput {
  readonly email: string;
  readonly tokenDurationSeconds?: number;
}

export interface RecoveryTokenIssued {
  readonly token: string;
  readonly expiresAt: string;
}

export interface ConsumeRecoveryTokenInput {
  readonly token: string;
  readonly newPassword: string;
}

export interface ProductCandidateSearchInput {
  readonly query: string;
  readonly locale: ProductSearchLocale;
  readonly limit: number;
}

export interface AccountService {
  registerAccount(input: RegisterAccountInput): Promise<AccountRegistration>;
  getAccount(accountId: AccountId): Promise<Account | null>;
  authenticate(input: AuthenticateInput): Promise<AuthenticatedSession>;
  resolveSession(sessionToken: string): Promise<Account | null>;
  signOut(sessionToken: string): Promise<void>;
  issueRecoveryToken(
    input: IssueRecoveryTokenInput,
  ): Promise<RecoveryTokenIssued>;
  consumeRecoveryToken(input: ConsumeRecoveryTokenInput): Promise<void>;
  setPrimaryExporter(
    accountId: AccountId,
    economyCode: string,
  ): Promise<Account>;
  searchProductCandidates(
    input: ProductCandidateSearchInput,
  ): Promise<ProductSearchResult>;
  confirmProduct(
    accountId: AccountId,
    product: ProductRef,
  ): Promise<readonly ConfirmedProduct[]>;
  removeProduct(
    accountId: AccountId,
    product: ProductRef,
  ): Promise<readonly ConfirmedProduct[]>;
  listConfirmedProducts(
    accountId: AccountId,
  ): Promise<readonly ConfirmedProduct[]>;
  deleteAccount(accountId: AccountId): Promise<void>;
}
