import { useEffect, useState } from 'react';
import { opApiClient } from '../../../utils/opApiClient';

/**
 * Resolves whether a username belongs to an accessible OP user.
 *
 * Returns `undefined` while the lookup is in flight (and for an empty
 * username, where there is nothing to look up), so callers can tell "not
 * checked yet" apart from "no such user" and avoid flashing a 404.
 */
export default function useUserExists(username) {
  const [exists, setExists] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    setExists(undefined);

    if (username) {
      opApiClient
        .get(`/user/@${username}`)
        .then(() => {
          if (!cancelled) setExists(true);
        })
        .catch((error) => {
          if (cancelled) return;
          const status = error?.response?.status;
          // 404: no such user. 403: inactive/restricted, i.e. not viewable.
          setExists(!(status === 404 || status === 403));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [username]);

  return exists;
}
