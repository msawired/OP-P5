import axios, { AxiosInstance } from 'axios';
import { getConfig } from './getConfig';

const ROOT_URL = getConfig('API_URL');

/** Server error code for accounts that moved to the new (OpenProcessing) editor. */
export const ACCOUNT_MIGRATED = 'ACCOUNT_MIGRATED';
/** Window event fired when any API call hits a migrated (or migrating) account. */
export const ACCOUNT_MIGRATED_EVENT = 'p5:account-migrated';

export interface AccountMigratedDetail {
  state: 'migrating' | 'migrated';
  newEditorUrl: string;
  message: string;
}

/**
 * Configures an Axios instance with the correct API URL
 */
function createClientInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: ROOT_URL,
    withCredentials: true
  });

  // One place to catch the migration error for every request; the
  // AccountMigrationNotice at the app root shows it. Callers still get the
  // rejection and handle their own state (saving spinners etc.).
  instance.interceptors.response.use(undefined, (error) => {
    const data = error?.response?.data;
    if (data?.code === ACCOUNT_MIGRATED && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<AccountMigratedDetail>(ACCOUNT_MIGRATED_EVENT, {
          detail: {
            state: data.state,
            newEditorUrl: data.newEditorUrl,
            message: data.message
          }
        })
      );
    }
    return Promise.reject(error);
  });

  return instance;
}

/** Axios instance configured with the API_URL as the ROOT URL */
export const apiClient = createClientInstance();
