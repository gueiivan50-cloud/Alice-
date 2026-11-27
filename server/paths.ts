import fs from 'node:fs';
import path from 'node:path';

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(ROOT_DIR, 'data');
export const DB_PATH = path.resolve(DATA_DIR, 'cineveo.sqlite');

export const STORAGE_DIR = path.resolve(ROOT_DIR, 'storage');
export const ORIGINALS_DIR = path.resolve(STORAGE_DIR, 'originals');
export const PREVIEWS_DIR = path.resolve(STORAGE_DIR, 'previews');
export const POSTERS_DIR = path.resolve(STORAGE_DIR, 'posters');
export const UPLOADS_TMP_DIR = path.resolve(STORAGE_DIR, 'uploads_tmp');
export const BACKUPS_DIR = path.resolve(STORAGE_DIR, 'backups');

export function ensureDirectories(): void {
  for (const dir of [
    DATA_DIR,
    STORAGE_DIR,
    ORIGINALS_DIR,
    PREVIEWS_DIR,
    POSTERS_DIR,
    UPLOADS_TMP_DIR,
    BACKUPS_DIR,
  ]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function safeResolveInside(baseDir: string, filename: string): string {
  const cleanName = path.basename(filename);
  if (!cleanName || cleanName === '.' || cleanName === '..') {
    throw new Error('Nom de fichier invalide');
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanName);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Acces fichier non autorise');
  }
  return resolvedTarget;
}
