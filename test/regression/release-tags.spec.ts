import { describe, expect, test } from 'vitest';
import { missingReleaseTags, remoteTagNames } from '../../scripts/release-tags.mjs';

/**
 * Round 77 (release gate 29.10.2026, "6a"): without the tags fetched, scripts/publish-packages.mjs compared against an
 * older release tag (v0.7.1 was missing locally on 28.10.) and would have published a package that had not moved. The
 * plan now stops when the remote holds a release tag below the version that the local tags lack.
 */
describe('the release tags a plan needs', () => {
  const lsRemote = [
    'a1b2c3\trefs/tags/v0.6.1',
    'd4e5f6\trefs/tags/v0.7.0',
    'f6e5d4\trefs/tags/v0.7.1',
    'f6e5d5\trefs/tags/v0.7.1^{}',
    '0a0b0c\trefs/tags/nightly-2026-10-01',
    '9f8e7d\trefs/tags/v2.0.0',
  ].join('\n');

  test('reads the tag names of git ls-remote, peeled entries once', () => {
    expect(remoteTagNames(lsRemote)).toEqual(['v0.6.1', 'v0.7.0', 'v0.7.1', 'nightly-2026-10-01', 'v2.0.0']);
  });

  test('names a release tag below the version that the local tags lack', () => {
    expect(missingReleaseTags('1.0.0', ['v0.6.1', 'v0.7.0'], remoteTagNames(lsRemote))).toEqual(['v0.7.1']);
  });

  test('passes when the local tags hold every release below the version; tags above it and other names do not count', () => {
    expect(missingReleaseTags('1.0.0', ['v0.6.1', 'v0.7.0', 'v0.7.1'], remoteTagNames(lsRemote))).toEqual([]);
    expect(missingReleaseTags('0.7.1', ['v0.6.1', 'v0.7.0'], remoteTagNames(lsRemote))).toEqual([]);
  });
});
