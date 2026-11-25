// Without the release tags fetched, the plan compares against an older release and publishes an unmoved package.

/** [major, minor, patch] of `1.2.3` or `v1.2.3`, else null. */
export const parseVersion = text => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match ? match.slice(1, 4).map(Number) : null;
};

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

export function missingReleaseTags(version, localTags, remoteTags) {
  const current = parseVersion(version);
  if (!current) throw new Error(`root version ${version} is not major.minor.patch`);
  const local = new Set(localTags);
  return remoteTags.filter(tag => {
    const parsed = parseVersion(tag);
    return parsed && tag.startsWith('v') && lower(parsed, current) && !local.has(tag);
  });
}
