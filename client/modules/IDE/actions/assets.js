import { opApiClient } from '../../../utils/opApiClient';
import * as ActionTypes from '../../../constants';
import { startLoader, stopLoader } from '../reducers/loading';
import { assetsActions } from '../reducers/assets';

const { setAssets, deleteAsset } = assetsActions;

function normalizeOpAsset(asset) {
  const visualID = asset.visualID == null ? null : String(asset.visualID);
  return {
    key: `${visualID ?? 'unknown'}:${asset.name}:${asset.url}`,
    name: asset.name,
    url: asset.url,
    size: asset.size,
    lastModified: asset.lastModified,
    visualID,
    sketchId: visualID,
    sketchName: asset.visualTitle
  };
}

export function getAssets() {
  return async (dispatch, getState) => {
    dispatch(startLoader());
    try {
      const { user } = getState();
      const response = await opApiClient.get(`/user/${user.id}/files`);
      const assets = response.data.map(normalizeOpAsset);

      const assetData = {
        assets,
        totalSize: assets.reduce((total, asset) => total + asset.size, 0)
      };

      dispatch(setAssets(assetData));
      dispatch(stopLoader());
    } catch (error) {
      dispatch({
        type: ActionTypes.ERROR
      });
      dispatch(stopLoader());
    }
  };
}

export function deleteAssetRequest(assetKey) {
  return async (dispatch, getState) => {
    try {
      const asset = getState().assets.list.find(
        (item) => item.key === assetKey
      );
      if (!asset?.visualID) {
        throw new Error('Only sketch files can be deleted.');
      }
      await opApiClient.delete(
        `/sketch/${asset.visualID}/files/${encodeURIComponent(asset.name)}`
      );
      dispatch(deleteAsset(assetKey));
    } catch (error) {
      dispatch({
        type: ActionTypes.ERROR
      });
    }
  };
}
