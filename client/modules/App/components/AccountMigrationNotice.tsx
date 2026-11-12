import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Overlay } from './Overlay';
import {
  ACCOUNT_MIGRATED_EVENT,
  AccountMigratedDetail
} from '../../../utils/apiClient';

/**
 * Shows the "account migrated" notice whenever any API call is rejected
 * because the account moved to the new editor (see apiClient's interceptor).
 * Mounted once at the app root, so it works on every page.
 */
export const AccountMigrationNotice = () => {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<AccountMigratedDetail | null>(null);

  useEffect(() => {
    const onMigrated = (event: Event) => {
      setDetail((event as CustomEvent<AccountMigratedDetail>).detail);
    };
    window.addEventListener(ACCOUNT_MIGRATED_EVENT, onMigrated);
    return () => window.removeEventListener(ACCOUNT_MIGRATED_EVENT, onMigrated);
  }, []);

  if (!detail) return null;

  const url = detail.newEditorUrl;
  return (
    <Overlay
      title={t('AccountMigration.Title')}
      ariaLabel={t('AccountMigration.Title')}
      closeOverlay={() => setDetail(null)}
    >
      <div className="error-modal__content">
        <p>
          <Trans
            i18nKey={
              detail.state === 'migrated'
                ? 'AccountMigration.Migrated'
                : 'AccountMigration.Migrating'
            }
            values={{ url }}
            components={{ link: <a href={url}>{url}</a> }}
          />
        </p>
      </div>
    </Overlay>
  );
};
