import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TreeEntry {
  type: 'blob' | 'tree';
  path: string;
  name: string;
}

function getWorkingTreeFiles(dirPath?: string): string[] {
  const pathArgs = dirPath ? [dirPath + '/'] : [];

  const tracked = execFileSync('git', ['ls-files', ...pathArgs], {
    encoding: 'utf-8',
  }).trim();

  const deleted = execFileSync('git', ['ls-files', '--deleted', ...pathArgs], {
    encoding: 'utf-8',
  }).trim();

  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', ...pathArgs],
    { encoding: 'utf-8' },
  ).trim();

  const deletedSet = new Set(deleted ? deleted.split('\n') : []);
  const files = new Set<string>();

  if (tracked) {
    for (const f of tracked.split('\n')) {
      if (!deletedSet.has(f)) {
        files.add(f);
      }
    }
  }
  if (untracked) {
    for (const f of untracked.split('\n')) {
      files.add(f);
    }
  }

  return Array.from(files).sort();
}

export function getTree(): string[] {
  return getWorkingTreeFiles();
}

export function getTreeEntries(_ref = 'HEAD', dirPath?: string): TreeEntry[] {
  const files = getWorkingTreeFiles(dirPath);
  const prefix = dirPath ? dirPath + '/' : '';
  const entries = new Map<string, TreeEntry>();

  for (const file of files) {
    const relative = file.slice(prefix.length);
    const slashIndex = relative.indexOf('/');
    if (slashIndex === -1) {
      entries.set(relative, { type: 'blob', path: file, name: relative });
    } else {
      const dirName = relative.slice(0, slashIndex);
      const fullPath = prefix + dirName;
      if (!entries.has(dirName)) {
        entries.set(dirName, { type: 'tree', path: fullPath, name: dirName });
      }
    }
  }

  return Array.from(entries.values());
}

export function getTreeFingerprint(): string {
  const tracked = execFileSync('git', ['ls-files'], {
    encoding: 'utf-8',
  }).trim();

  const statOutput = execFileSync(
    'git',
    ['status', '--porcelain', '-u'],
    { encoding: 'utf-8' },
  ).trim();

  return `${tracked.length}:${statOutput}`;
}

export function getWorkingTreeFileContent(filePath: string): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  }).trim();
  return readFileSync(join(root, filePath), 'utf-8');
}

export function getWorkingTreeRawFile(filePath: string): { data: Buffer; fullPath: string } {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  }).trim();
  const fullPath = join(root, filePath);
  return { data: readFileSync(fullPath), fullPath };
}
