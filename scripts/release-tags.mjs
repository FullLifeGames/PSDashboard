/**
 * Release versions and tags: the version helpers of scripts/publish-packages.mjs and the check that the local tags hold
 * every release tag below the version being released (round 77, release gate 29.10.2026, "6a"). Without the tags fetched,
 * the plan compared against an older release (v0.7.1 was missing locally on 28.10.) and would have published a package
 * that had not moved.
 */

/** [major, minor, patch] of `1.2.3` or `v1.2.3`, else null. */
export const parseVersion = text => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? match.slice(1, 4).map(Number) : null;
};

/** Whether version `a` sorts below version `b`. */
export const lower = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** The tag names of `git ls-remote --tags` output, each once (the peeled `^{}` entry of an annotated tag folds in). */
export function remoteTagNames(lsRemoteOutput) {
  const names = lsRemoteOutput.split(/\r?\n/)
    .map(line => /\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line)?.[1])
    .filter(Boolean);
  return [...new Set(names)];
}

/** The remote's release tags below `version` that the local tags lack. */
export function missingReleaseTags(version, localTags, remoteTags) {
  const current = parseVersion(version);
  if (!current) throw new Error(`root version ${version} is not major.minor.patch`);
  const local = new Set(localTags);
  return remoteTags.filter(tag => {
    const parsed = parseVersion(tag);
    return parsed && tag.startsWith('v') && lower(parsed, current) && !local.has(tag);
  });
}
