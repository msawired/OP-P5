import { Request as MockRequest } from 'jest-express/lib/request';
import { Response as MockResponse } from 'jest-express/lib/response';
import { Request, Response } from 'express';
import {
  flattenProjectFiles,
  resolveAssetSource,
  setMigrationStatus
} from '../migration.controller';
import {
  signMigrationRequest,
  verifyMigrationSignature
} from '../../middleware/verifyMigrationSignature';
import { rejectIfMigrated } from '../../middleware/rejectIfMigrated';
import { User } from '../../models/user';

jest.mock('../../models/user', () => ({
  User: { findOneAndUpdate: jest.fn() }
}));
jest.mock('../../models/project', () => ({}));
jest.mock('../../models/collection', () => ({}));

describe('flattenProjectFiles', () => {
  const files = [
    {
      _id: 'r',
      name: 'root',
      fileType: 'folder',
      children: ['a', 'b', 'c', 'e']
    },
    {
      _id: 'a',
      name: 'sketch.js',
      fileType: 'file',
      content: 'draw()',
      isSelectedFile: true
    },
    { _id: 'b', name: 'assets', fileType: 'folder', children: ['d', 'x'] },
    { _id: 'c', name: 'index.html', fileType: 'file', content: '<html>' },
    {
      _id: 'd',
      name: 'cat.png',
      fileType: 'file',
      url: 'https://example.com/cat.png'
    },
    { _id: 'e', name: 'empty', fileType: 'folder', children: [] },
    { _id: 'x', name: '..', fileType: 'file', content: 'bad' },
    { _id: 'o', name: 'orphan.js', fileType: 'file', content: 'unreachable' }
  ];

  it('builds paths in tree order and splits code from assets', () => {
    const result = flattenProjectFiles(files);
    expect(result.code).toEqual([
      { path: 'sketch.js', content: 'draw()' },
      { path: 'index.html', content: '<html>' }
    ]);
    expect(result.assets).toEqual([
      { path: 'assets/cat.png', url: 'https://example.com/cat.png' }
    ]);
    expect(result.selectedPath).toBe('sketch.js');
  });

  it('survives a cycle and a missing root', () => {
    const cyclic = [
      { _id: 'r', name: 'root', fileType: 'folder', children: ['f'] },
      { _id: 'f', name: 'loop', fileType: 'folder', children: ['f', 'r'] }
    ];
    expect(flattenProjectFiles(cyclic).code).toEqual([]);
    expect(flattenProjectFiles([{ _id: 'a', name: 'a.js' }]).code).toEqual([]);
  });
});

describe('resolveAssetSource', () => {
  const { env } = process;
  beforeEach(() => {
    process.env = {
      ...env,
      S3_BUCKET: 'p5js-web-editor',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_URL_BASE: 'https://assets.editor.p5js.org/'
    };
  });
  afterEach(() => {
    process.env = env;
  });

  it('resolves the configured base, region URL, and both S3 styles', () => {
    const expected = { bucket: 'p5js-web-editor', key: 'abc123/cat%2.png' };
    expect(
      resolveAssetSource(
        'https://assets.editor.p5js.org/abc123/cat%252.png?v=1'
      )
    ).toEqual(expected);
    expect(
      resolveAssetSource(
        'https://s3-us-east-1.amazonaws.com/p5js-web-editor/abc123/cat%252.png'
      )
    ).toEqual(expected);
    expect(
      resolveAssetSource(
        'https://p5js-web-editor.s3.amazonaws.com/abc123/cat%252.png'
      )
    ).toEqual(expected);
    expect(
      resolveAssetSource(
        'https://s3.us-west-2.amazonaws.com/p5js-web-editor/abc123/cat%252.png'
      )
    ).toEqual(expected);
  });

  it('returns null for external URLs and other buckets', () => {
    expect(resolveAssetSource('https://example.com/cat.png')).toBeNull();
    expect(
      resolveAssetSource('https://other-bucket.s3.amazonaws.com/cat.png')
    ).toBeNull();
    expect(
      resolveAssetSource('ftp://p5js-web-editor.s3.amazonaws.com/cat.png')
    ).toBeNull();
  });
});

describe('verifyMigrationSignature', () => {
  const { env } = process;
  const secret = 'test-secret';
  const path = '/migration/manifest/jane.doe';
  let request: MockRequest;
  let response: MockResponse;
  let next: jest.Mock;

  const run = () =>
    verifyMigrationSignature(
      (request as unknown) as Request,
      (response as unknown) as Response,
      next
    );

  const signedRequest = (ts: string, sig: string) => {
    request = new MockRequest(path, {
      method: 'GET',
      headers: { 'X-P5-Timestamp': ts, 'X-P5-Signature': sig }
    });
    (request as any).originalUrl = path;
    (request as any).ip = '10.0.0.1';
  };

  beforeEach(() => {
    process.env = { ...env, P5_MIGRATION_HMAC_SECRET: secret };
    response = new MockResponse();
    next = jest.fn();
  });
  afterEach(() => {
    process.env = env;
  });

  it('accepts a valid, fresh signature', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    signedRequest(ts, signMigrationRequest('GET', path, ts, secret));
    run();
    expect(next).toHaveBeenCalled();
  });

  it('rejects a wrong signature, a stale timestamp, and a disallowed IP', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    signedRequest(ts, signMigrationRequest('GET', path, ts, 'other-secret'));
    run();
    expect(response.status).toHaveBeenCalledWith(401);

    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    signedRequest(stale, signMigrationRequest('GET', path, stale, secret));
    run();
    expect(response.status).toHaveBeenCalledWith(401);

    process.env.P5_MIGRATION_ALLOWED_IPS = '192.168.1.1';
    signedRequest(ts, signMigrationRequest('GET', path, ts, secret));
    run();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('hides the endpoints when no secret is configured', () => {
    delete process.env.P5_MIGRATION_HMAC_SECRET;
    signedRequest('0', '');
    run();
    expect(response.status).toHaveBeenCalledWith(404);
  });
});

describe('rejectIfMigrated', () => {
  const run = (method: 'GET' | 'POST' | 'PUT', user: unknown) => {
    const request = new MockRequest('/editor/projects', { method });
    (request as any).user = user;
    const response = new MockResponse();
    const next = jest.fn();
    rejectIfMigrated(
      (request as unknown) as Request,
      (response as unknown) as Response,
      next
    );
    return { response, next };
  };

  it('blocks writes from migrating and migrated accounts with 423', () => {
    ['migrating', 'migrated'].forEach((state) => {
      const { response, next } = run('POST', { migration: { state } });
      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(423);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ACCOUNT_MIGRATED', state })
      );
    });
  });

  it('lets everything through when P5_MIGRATION_FREEZE_MIGRATED=false', () => {
    const { env } = process;
    process.env = { ...env, P5_MIGRATION_FREEZE_MIGRATED: 'false' };
    try {
      expect(
        run('POST', { migration: { state: 'migrated' } }).next
      ).toHaveBeenCalled();
    } finally {
      process.env = env;
    }
  });

  it('lets reads through, and everyone who is not migrating', () => {
    expect(
      run('GET', { migration: { state: 'migrated' } }).next
    ).toHaveBeenCalled();
    expect(run('PUT', { migration: {} }).next).toHaveBeenCalled();
    expect(run('PUT', undefined).next).toHaveBeenCalled();
  });
});

describe('setMigrationStatus', () => {
  const call = async (query: Record<string, string>) => {
    const request = new MockRequest('/migration/status', { method: 'POST' });
    (request as any).query = query;
    const response = new MockResponse();
    await setMigrationStatus(
      (request as unknown) as Request,
      (response as unknown) as Response
    );
    return response;
  };

  beforeEach(() => (User.findOneAndUpdate as jest.Mock).mockReset());

  it('rejects a bad state, both or neither identifiers, and a bad id', async () => {
    expect(
      (await call({ username: 'a', state: 'done' })).status
    ).toHaveBeenCalledWith(400);
    expect((await call({ state: 'migrated' })).status).toHaveBeenCalledWith(
      400
    );
    expect(
      (
        await call({
          username: 'a',
          p5UserID: '6aeddf23c3d0b1d62e2ff77a',
          state: 'none'
        })
      ).status
    ).toHaveBeenCalledWith(400);
    expect(
      (await call({ p5UserID: 'nope', state: 'none' })).status
    ).toHaveBeenCalledWith(400);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('sets migrated with the OP account, and unsets on none', async () => {
    const exec = jest.fn().mockResolvedValue({
      _id: { toHexString: () => 'id' },
      username: 'jane',
      migration: { state: 'migrated' }
    });
    (User.findOneAndUpdate as jest.Mock).mockReturnValue({ exec });

    await call({
      username: 'jane',
      state: 'migrated',
      opUserID: '42',
      opUsername: 'p5_jane'
    });
    const [filter, update] = (User.findOneAndUpdate as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ username: 'jane' });
    expect(update.$set.migration).toEqual(
      expect.objectContaining({
        state: 'migrated',
        opUserID: 42,
        opUsername: 'p5_jane'
      })
    );

    await call({ username: 'jane', state: 'none' });
    expect((User.findOneAndUpdate as jest.Mock).mock.calls[1][1]).toEqual({
      $unset: { migration: 1 }
    });
  });
});
