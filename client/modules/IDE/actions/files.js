import objectID from 'bson-objectid';
import blobUtil from 'blob-util';
import { opApiClient } from '../../../utils/opApiClient';
import * as ActionTypes from '../../../constants';
import {
  setUnsavedChanges,
  closeNewFolderModal,
  closeNewFileModal,
  setSelectedFile
} from './ide';
import { createError } from './ide';

export function appendToFilename(filename, string) {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return filename + string;
  return (
    filename.substring(0, dotIndex) + string + filename.substring(dotIndex)
  );
}

export function createUniqueName(name, parentId, files) {
  const siblingFiles = files
    .find((file) => file.id === parentId)
    .children.map((childFileId) =>
      files.find((file) => file.id === childFileId)
    );
  let testName = name;
  let index = 1;
  let existingName = siblingFiles.find((file) => name === file.name);

  while (existingName) {
    testName = appendToFilename(name, `-${index}`);
    index += 1;
    existingName = siblingFiles.find((file) => testName === file.name); // eslint-disable-line
  }
  return testName;
}

export function updateFileContent(id, content) {
  return {
    type: ActionTypes.UPDATE_FILE_CONTENT,
    id,
    content
  };
}

export function createFile(file, parentId) {
  return {
    type: ActionTypes.CREATE_FILE,
    ...file,
    parentId
  };
}

export function submitFile(formProps, files, parentId, projectId) {
  const id = objectID().toHexString();
  const file = {
    name: createUniqueName(formProps.name, parentId, files),
    id,
    _id: id,
    url: formProps.url,
    content: formProps.content || '',
    children: []
  };
  if (projectId) {
    file.projectId = projectId;
  }
  return Promise.resolve({
    file
  });
}

export function handleCreateFile(formProps, setSelected = true) {
  return (dispatch, getState) => {
    const state = getState();
    const { files } = state;
    const { parentId } = state.ide;
    const projectId = state.project.id;
    return new Promise((resolve) => {
      submitFile(formProps, files, parentId, projectId)
        .then((response) => {
          const { file } = response;
          dispatch(createFile(file, parentId));
          dispatch(closeNewFileModal());
          dispatch(setUnsavedChanges(true));
          if (setSelected) {
            dispatch(setSelectedFile(file.id));
          }
          resolve();
        })
        .catch((error) => {
          const { response } = error;
          dispatch(createError(response.data));
          resolve({ error });
        });
    });
  };
}

export function submitFolder(formProps, files, parentId, projectId) {
  const id = objectID().toHexString();
  const file = {
    type: ActionTypes.CREATE_FILE,
    name: createUniqueName(formProps.name, parentId, files),
    id,
    _id: id,
    content: '',
    // TODO pass parent id from File Tree
    fileType: 'folder',
    children: []
  };
  if (projectId) {
    file.projectId = projectId;
  }
  return Promise.resolve({
    file
  });
}

export function handleCreateFolder(formProps) {
  return (dispatch, getState) => {
    const state = getState();
    const { files } = state;
    const { parentId } = state.ide;
    const projectId = state.project.id;
    return new Promise((resolve) => {
      submitFolder(formProps, files, parentId, projectId)
        .then((response) => {
          const { file } = response;
          dispatch(createFile(file, parentId));
          dispatch(closeNewFolderModal());
          dispatch(setUnsavedChanges(true));
          resolve();
        })
        .catch((error) => {
          const { response } = error;
          dispatch(createError(response.data));
          resolve({ error });
        });
    });
  };
}

export function updateFileName(id, name) {
  return async (dispatch, getState) => {
    const state = getState();
    const file = state.files.find((candidate) => candidate.id === id);
    let updatedName = name;
    let updatedUrl;

    if (state.project.id && file?.url) {
      try {
        const response = await opApiClient.patch(
          `/sketch/${state.project.id}/files/${encodeURIComponent(file.name)}`,
          { name }
        );
        updatedName = response.data.name || name;
        updatedUrl = response.data.url;
      } catch (error) {
        const { response } = error;
        dispatch({
          type: ActionTypes.ERROR,
          error: response?.data ?? { message: error.message }
        });
        return { error };
      }
    } else {
      dispatch(setUnsavedChanges(true));
    }

    dispatch({
      type: ActionTypes.UPDATE_FILE_NAME,
      id,
      name: updatedName,
      url: updatedUrl
    });
    return { name: updatedName, url: updatedUrl };
  };
}

export function deleteFile(id, parentId) {
  return async (dispatch, getState) => {
    const state = getState();
    const file = state.files.find((candidate) => candidate.id === id);
    if (state.project.id && file?.url) {
      try {
        await opApiClient.delete(
          `/sketch/${state.project.id}/files/${encodeURIComponent(file.name)}`
        );
      } catch (error) {
        const { response } = error;
        dispatch({
          type: ActionTypes.ERROR,
          error: response?.data ?? { message: error.message }
        });
        return;
      }
    }

    dispatch({
      type: ActionTypes.DELETE_FILE,
      id,
      parentId
    });

    if (!file?.url) {
      dispatch(setUnsavedChanges(true));
    }
  };
}

export function showFolderChildren(id) {
  return {
    type: ActionTypes.SHOW_FOLDER_CHILDREN,
    id
  };
}

export function hideFolderChildren(id) {
  return {
    type: ActionTypes.HIDE_FOLDER_CHILDREN,
    id
  };
}

export function setBlobUrl(file, blobURL) {
  return {
    type: ActionTypes.SET_BLOB_URL,
    id: file.id,
    blobURL
  };
}

export function getBlobUrl(file) {
  if (file.blobUrl) {
    blobUtil.revokeObjectURL(file.blobUrl);
  }

  const fileBlob = blobUtil.createBlob([file.content], { type: 'text/plain' });
  const blobURL = blobUtil.createObjectURL(fileBlob);
  return blobURL;
}
