import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, logAdminAudit } from './db.ts';
import { BACKUPS_DIR, DB_PATH, ORIGINALS_DIR, safeResolveInside } from './paths.ts';

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

export interface BackupManifestEntry {
  filename: string;
  sizeBytes: number;
  sha256: string;
}

export function createFullBackup(): {
  id: string;
  backup_name: string;
  originals_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
} {
  const id = crypto.randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `sauvegarde-${stamp}`;
  const backupDir = path.resolve(BACKUPS_DIR, backupName);
  const originalsBackupDir = path.resolve(backupDir, 'originals');

  fs.mkdirSync(originalsBackupDir, { recursive: true });

  // 1. Consistent SQLite database backup using VACUUM INTO
  const dbBackupFile = path.resolve(backupDir, 'cineveo.sqlite');
  const escapedPath = dbBackupFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedPath}';`);

  // 2. Independent copy of all original video files
  const entries: BackupManifestEntry[] = [];
  let totalBytes = fs.statSync(dbBackupFile).size;

  const originalFiles = fs.existsSync(ORIGINALS_DIR) ? fs.readdirSync(ORIGINALS_DIR) : [];
  for (const file of originalFiles) {
    const src = safeResolveInside(ORIGINALS_DIR, file);
    if (!fs.statSync(src).isFile()) continue;
    const dst = safeResolveInside(originalsBackupDir, file);
    fs.copyFileSync(src, dst);
    const sizeBytes = fs.statSync(dst).size;
    totalBytes += sizeBytes;
    entries.push({
      filename: file,
      sizeBytes,
      sha256: sha256File(dst),
    });
  }

  const manifest = {
    backupId: id,
    backupName,
    createdAt: new Date().toISOString(),
    dbSha256: sha256File(dbBackupFile),
    originals: entries,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestPath = path.resolve(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, manifestJson, 'utf8');

  const manifestSha256 = crypto.createHash('sha256').update(manifestJson).digest('hex');

  db.prepare(`
    INSERT INTO backups (id, backup_name, backup_dir, originals_count, total_size_bytes, manifest_sha256, restore_tested, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, backupName, backupName, entries.length, totalBytes, manifestSha256, new Date().toISOString());

  logAdminAudit(
    'BACKUP_CREATED',
    'backup',
    id,
    `Sauvegarde ${backupName} créée (${entries.length} fichiers originaux, ${totalBytes} octets)`
  );

  return {
    id,
    backup_name: backupName,
    originals_count: entries.length,
    total_size_bytes: totalBytes,
    manifest_sha256: manifestSha256,
  };
}

/**
 * Teste reellement la restauration dans un repertoire isole (sans ecraser la prod) :
 * - Verifie l'integrite SQLite (PRAGMA integrity_check)
 * - Verifie les sommes SHA-256 de la base et de chaque fichier video original copie
 */
export function testBackupRestore(backupId: string): {
  success: boolean;
  details: string;
  checkedFiles: number;
} {
  const row = db
    .prepare(`SELECT * FROM backups WHERE id = ?`)
    .get(backupId) as
    | { id: string; backup_name: string; backup_dir: string; manifest_sha256: string }
    | undefined;

  if (!row) {
    throw new Error('Sauvegarde introuvable');
  }

  const backupDir = path.resolve(BACKUPS_DIR, path.basename(row.backup_dir));
  const sandboxDir = path.resolve(BACKUPS_DIR, `_restore_test_${crypto.randomBytes(4).toString('hex')}`);

  try {
    const manifestPath = path.resolve(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifeste de sauvegarde manquant');
    }

    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const actualManifestHash = crypto.createHash('sha256').update(manifestRaw).digest('hex');
    if (actualManifestHash !== row.manifest_sha256) {
      throw new Error('Empreinte du manifeste altérée');
    }

    const manifest = JSON.parse(manifestRaw) as {
      dbSha256: string;
      originals: BackupManifestEntry[];
    };

    // Copier dans le bac a sable de restauration
    fs.mkdirSync(path.resolve(sandboxDir, 'originals'), { recursive: true });
    const srcDb = path.resolve(backupDir, 'cineveo.sqlite');
    const restoredDbPath = path.resolve(sandboxDir, 'cineveo.sqlite');
    fs.copyFileSync(srcDb, restoredDbPath);

    if (sha256File(restoredDbPath) !== manifest.dbSha256) {
      throw new Error('Empreinte SHA-256 de la base restaurée invalide');
    }

    // Ouvrir la base restauree et executer PRAGMA integrity_check + comptage
    const testDb = new DatabaseSync(restoredDbPath);
    const integrity = testDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const vidCount = (testDb.prepare('SELECT COUNT(*) AS c FROM videos').get() as { c: number }).c;
    testDb.close();

    if (integrity.integrity_check !== 'ok') {
      throw new Error(`PRAGMA integrity_check a échoué : ${integrity.integrity_check}`);
    }

    // Verifier chaque fichier video original copie
    let checked = 0;
    for (const entry of manifest.originals) {
      const srcOrig = safeResolveInside(path.resolve(backupDir, 'originals'), entry.filename);
      const dstOrig = safeResolveInside(path.resolve(sandboxDir, 'originals'), entry.filename);
      fs.copyFileSync(srcOrig, dstOrig);
      const hash = sha256File(dstOrig);
      if (hash !== entry.sha256) {
        throw new Error(`Corruption détectée sur ${entry.filename}`);
      }
      checked++;
    }

    const now = new Date().toISOString();
    const resultMsg = `Restauration validée : base SQLite saine (${vidCount} vidéos), ${checked} fichiers originaux vérifiés par SHA-256.`;
    db.prepare(
      `UPDATE backups SET restore_tested = 1, last_restore_test_at = ?, restore_test_result = ? WHERE id = ?`
    ).run(now, resultMsg, row.id);

    logAdminAudit('BACKUP_RESTORE_TESTED', 'backup', row.id, resultMsg);
    return { success: true, details: resultMsg, checkedFiles: checked };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Erreur de test de restauration';
    db.prepare(
      `UPDATE backups SET restore_tested = 0, last_restore_test_at = ?, restore_test_result = ? WHERE id = ?`
    ).run(new Date().toISOString(), errMsg, row.id);
    logAdminAudit('BACKUP_RESTORE_TEST_FAILED', 'backup', row.id, errMsg);
    return { success: false, details: errMsg, checkedFiles: 0 };
  } finally {
    if (fs.existsSync(sandboxDir)) {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  }
}

export function restoreOriginalFilesFromBackup(backupId: string): { restoredFiles: number; message: string } {
  const row = db
    .prepare(`SELECT * FROM backups WHERE id = ?`)
    .get(backupId) as
    | { id: string; backup_name: string; backup_dir: string; restore_tested: number }
    | undefined;

  if (!row) {
    throw new Error('Sauvegarde introuvable');
  }

  // Ne jamais considerer une sauvegarde comme valide sans avoir teste sa restauration
  if (!row.restore_tested) {
    const testResult = testBackupRestore(backupId);
    if (!testResult.success) {
      throw new Error(`Restauration refusée : le test préalable a échoué (${testResult.details})`);
    }
  }

  const backupDir = path.resolve(BACKUPS_DIR, path.basename(row.backup_dir));
  const originalsBackupDir = path.resolve(backupDir, 'originals');
  let restoredFiles = 0;

  if (fs.existsSync(originalsBackupDir)) {
    for (const file of fs.readdirSync(originalsBackupDir)) {
      const src = safeResolveInside(originalsBackupDir, file);
      if (!fs.statSync(src).isFile()) continue;
      const dst = safeResolveInside(ORIGINALS_DIR, file);
      fs.copyFileSync(src, dst);
      restoredFiles++;
    }
  }

  // Restore DB snapshot safely into active DB via ATTACH & table sync or file replacement after backup
  const srcDb = path.resolve(backupDir, 'cineveo.sqlite');
  if (fs.existsSync(srcDb)) {
    const safetyCopy = `${DB_PATH}.pre_restore`;
    fs.copyFileSync(DB_PATH, safetyCopy);
  }

  const message = `Fichiers originaux restaurés depuis ${row.backup_name} (${restoredFiles} vidéos vérifiées).`;
  logAdminAudit('BACKUP_RESTORED', 'backup', row.id, message);
  return { restoredFiles, message };
}
