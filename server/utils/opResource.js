import axios from 'axios';

/**
 * Server-side existence checks against the OpenProcessing API.
 *
 * The editor server has no database of its own, but the initial document
 * response still has to carry the right status code: without this, every URL
 * — including sketches and users that don't exist — would return 200 with the
 * SPA shell, which crawlers read as a valid page (a "soft 404").
 *
 * These checks are deliberately conservative: only an explicit 404 from OP
 * counts as missing. Private/unauthorized resources (403) and API outages
 * resolve as "exists" so the client, which holds the user's own token, can
 * make the final call.
 */

const REQUEST_TIMEOUT_MS = 5000;

async function getFromOp(path) {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    // Without an API to ask, assume the resource exists.
    return { status: 200, data: null };
  }

  const headers = process.env.API_TOKEN
    ? { Authorization: `Bearer ${process.env.API_TOKEN}` }
    : undefined;

  try {
    const response = await axios.get(`${apiUrl}${path}`, {
      headers,
      timeout: REQUEST_TIMEOUT_MS
    });
    return { status: response.status, data: response.data };
  } catch (error) {
    const status = error?.response?.status;
    if (status) {
      return { status, data: error.response.data };
    }
    // Network error/timeout — don't turn an OP outage into 404s.
    console.error(`Existence check failed for ${path}:`, error.message);
    return { status: 200, data: null };
  }
}

function ownerMatches(resource, username) {
  if (!username || !resource?.username) {
    return true;
  }
  return String(resource.username).toLowerCase() === username.toLowerCase();
}

/**
 * A sketch exists at this URL when OP knows the id and — for owner-scoped
 * URLs like /:username/sketches/:project_id — the sketch belongs to that user.
 */
export async function sketchExists(projectId, username) {
  if (!/^\d+$/.test(String(projectId))) {
    return false;
  }

  const { status, data } = await getFromOp(`/sketch/${projectId}`);
  if (status === 404) {
    return false;
  }
  if (status !== 200 || !data) {
    return true;
  }
  return ownerMatches(data, username);
}

export async function userExists(username) {
  if (!username) {
    return false;
  }

  const { status } = await getFromOp(`/user/@${encodeURIComponent(username)}`);
  // 403 means inactive or restricted, i.e. not viewable by anyone else.
  return status !== 404 && status !== 403;
}

export async function collectionExists(collectionId, username) {
  if (!collectionId) {
    return false;
  }

  const { status, data } = await getFromOp(
    `/curation/${encodeURIComponent(collectionId)}`
  );
  if (status === 404) {
    return false;
  }
  if (status !== 200 || !data) {
    return true;
  }
  return ownerMatches(data, username);
}
