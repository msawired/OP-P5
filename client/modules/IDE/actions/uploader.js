import { TEXT_FILE_REGEX } from '../../../../server/utils/fileUtils';
import { opApiClient } from '../../../utils/opApiClient';
import { handleCreateFile } from './files';
import { showErrorModal } from './ide';

const MAX_LOCAL_FILE_SIZE = 80000; // bytes, aka 80 KB
const uploadPoliciesBySketchId = {};

function isS3Upload(file) {
  return !TEXT_FILE_REGEX.test(file.name) || file.size >= MAX_LOCAL_FILE_SIZE;
}

function buildUploadedFileUrl(fileBase, filename) {
  const base = fileBase.endsWith('/') ? fileBase : `${fileBase}/`;
  return encodeURI(`${base}${filename}`);
}

async function getUploadPolicy(projectId) {
  if (!uploadPoliciesBySketchId[projectId]) {
    uploadPoliciesBySketchId[projectId] = opApiClient
      .get(`/sketch/${projectId}/fileUploadPolicy`)
      .then((response) => response.data)
      .catch((error) => {
        delete uploadPoliciesBySketchId[projectId];
        throw error;
      });
  }
  return uploadPoliciesBySketchId[projectId];
}

export function getDropzoneUploadUrl(files) {
  return files[0]?.postData?.bucket ?? '';
}

export async function dropzoneAcceptCallback(projectId, file, done, dispatch) {
  // if a user would want to edit this file as text, local interceptor
  if (!isS3Upload(file)) {
    try {
      // eslint-disable-next-line no-param-reassign
      file.content = await file.text();
      // Make it an error so that it won't be sent to S3, but style as a success.
      done('Uploading plaintext file locally.');
      file.previewElement.classList.remove('dz-error');
      file.previewElement.classList.add('dz-success');
      file.previewElement.classList.add('dz-processing');
      file.previewElement.querySelector('.dz-upload').style.width = '100%';
    } catch (error) {
      done(`Failed to download file ${file.name}: ${error}`);
      console.warn(file);
    }
  } else {
    if (!projectId) {
      done('Please save this sketch before uploading asset files.');
      return;
    }
    try {
      file.postData = await getUploadPolicy(projectId);
      done();
    } catch (error) {
      if (error?.response?.status === 403 || error?.response?.status === 413) {
        if (dispatch) {
          dispatch(showErrorModal('uploadLimit'));
        }
        done('Upload limit reached.');
        return;
      }
      done(
        error?.response?.data?.responseText?.message ||
          error?.message ||
          'Error: Reached upload limit.'
      );
    }
  }
}

export function dropzoneSendingCallback(file, xhr, formData) {
  if (isS3Upload(file)) {
    Object.keys(file.postData).forEach((key) => {
      if (key !== 'bucket' && file.postData[key] !== undefined) {
        formData.append(key, file.postData[key]);
      }
    });
    formData.append('Content-Type', file.type || '');
  }
}

export function dropzoneCompleteCallback(file) {
  return (dispatch, getState) => {
    if (isS3Upload(file) && file.postData && file.status !== 'error') {
      const { fileBase } = getState().project;
      if (!fileBase) {
        console.warn('Missing OP fileBase; uploaded file URL was not added.');
        return;
      }
      const formParams = {
        name: file.name,
        url: buildUploadedFileUrl(fileBase, file.name)
      };
      dispatch(handleCreateFile(formParams, false));
    } else if (file.content !== undefined) {
      const formParams = {
        name: file.name,
        content: file.content
      };
      dispatch(handleCreateFile(formParams, false));
    } else if (file.status === 'error' || file.xhr.status >= 400) {
      let uploadFileErrorMessage = 'Uploading file to AWS failed.';
      if (file.xhr?.response) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(file.xhr.response, 'text/xml');
        const message = xmlDoc.getElementsByTagName('Message')[0]?.textContent;
        const code = xmlDoc.getElementsByTagName('Code')[0]?.textContent;
        uploadFileErrorMessage = `${code}: ${message}`;
      }
      file.previewElement.classList.add('dz-error');
      file.previewElement.classList.remove('dz-success');
      const dzErrorMessageElement = file.previewElement?.querySelector(
        '[data-dz-errormessage]'
      );
      if (dzErrorMessageElement) {
        dzErrorMessageElement.textContent = uploadFileErrorMessage;
      }
    }
  };
}
