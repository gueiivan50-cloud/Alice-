import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ORIGINALS_DIR, PREVIEWS_DIR, safeResolveInside } from './paths.ts';

const execFileAsync = promisify(execFile);

interface SeedVideoMediaSpec {
  previewFilename: string;
  originalFilename: string;
  color: string;
  accent: string;
  freq: number;
}

const SEED_SPECS: SeedVideoMediaSpec[] = [
  { previewFilename: 'preview_lagune_nuit.mp4', originalFilename: 'orig_lagune_nuit.mp4', color: '#0f172a', accent: '#f59e0b', freq: 220 },
  { previewFilename: 'preview_foret_cacao.mp4', originalFilename: 'orig_foret_cacao.mp4', color: '#14281d', accent: '#d97706', freq: 261 },
  { previewFilename: 'preview_etalonnage_cinema.mp4', originalFilename: 'orig_etalonnage_cinema.mp4', color: '#18181b', accent: '#e50914', freq: 293 },
  { previewFilename: 'preview_pluie_plateau.mp4', originalFilename: 'orig_pluie_plateau.mp4', color: '#09090b', accent: '#dc2626', freq: 329 },
  { previewFilename: 'preview_kora_acoustique.mp4', originalFilename: 'orig_kora_acoustique.mp4', color: '#27170e', accent: '#fbbf24', freq: 392 },
  { previewFilename: 'preview_braises_abidjan.mp4', originalFilename: 'orig_braises_abidjan.mp4', color: '#1f1209', accent: '#ea580c', freq: 440 },
];

const pendingGenerations = new Map<string, Promise<void>>();

async function generateSyntheticMp4(
  outputPath: string,
  durationSeconds: number,
  bgColor: string,
  accentColor: string,
  audioFreq: number,
  width: number,
  height: number
): Promise<void> {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1024) {
    return;
  }

  const existing = pendingGenerations.get(outputPath);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const tmpPath = `${outputPath}.${process.pid}.tmp.mp4`;
    try {
      // Real valid H.264/AAC MP4 video generated atomically via ffmpeg
      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `color=c=${bgColor}:s=${width}x${height}:d=${durationSeconds}:r=24`,
        '-f', 'lavfi',
        '-i', `sine=frequency=${audioFreq}:duration=${durationSeconds}`,
        '-vf', `drawbox=x=0:y=ih-14:w='iw*(t/${durationSeconds})':h=14:color=${accentColor}:t=fill,drawbox=x=40:y=40:w=iw-80:h=ih-80:color=${accentColor}@0.35:t=2`,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-threads', '2',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        tmpPath,
      ]);
      if (fs.existsSync(tmpPath)) {
        fs.renameSync(tmpPath, outputPath);
      }
    } finally {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failure
        }
      }
      pendingGenerations.delete(outputPath);
    }
  })();

  pendingGenerations.set(outputPath, task);
  return task;
}

export async function ensureSeedFileReady(filename: string): Promise<boolean> {
  try {
    for (const spec of SEED_SPECS) {
      if (spec.previewFilename === filename) {
        const previewPath = safeResolveInside(PREVIEWS_DIR, spec.previewFilename);
        await generateSyntheticMp4(previewPath, 5, spec.color, spec.accent, spec.freq, 640, 360);
        return fs.existsSync(previewPath);
      }
      if (spec.originalFilename === filename) {
        const originalPath = safeResolveInside(ORIGINALS_DIR, spec.originalFilename);
        await generateSyntheticMp4(originalPath, 8, spec.color, spec.accent, spec.freq, 1280, 720);
        return fs.existsSync(originalPath);
      }
    }
  } catch (err) {
    console.error(`Unable to generate seed media (${filename}):`, err);
  }
  return false;
}

function cleanupStaleTempMp4s(dir: string): void {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.tmp.mp4')) {
        try {
          fs.unlinkSync(path.join(dir, entry));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

export async function ensureSeedMediaFiles(
  onOriginalReady?: (originalFilename: string, sizeBytes: number) => void
): Promise<void> {
  cleanupStaleTempMp4s(PREVIEWS_DIR);
  cleanupStaleTempMp4s(ORIGINALS_DIR);

  // Generate lightweight previews first so storefront playback works immediately
  for (const spec of SEED_SPECS) {
    const previewPath = safeResolveInside(PREVIEWS_DIR, spec.previewFilename);
    await generateSyntheticMp4(previewPath, 5, spec.color, spec.accent, spec.freq, 640, 360);
  }

  // Then generate HD originals in the background
  for (const spec of SEED_SPECS) {
    const originalPath = safeResolveInside(ORIGINALS_DIR, spec.originalFilename);
    await generateSyntheticMp4(originalPath, 8, spec.color, spec.accent, spec.freq, 1280, 720);
    if (onOriginalReady && fs.existsSync(originalPath)) {
      onOriginalReady(spec.originalFilename, fs.statSync(originalPath).size);
    }
  }
}

export async function generatePreviewFromOriginal(
  originalFilename: string,
  previewFilename: string
): Promise<{ durationSeconds: number; generated: boolean }> {
  const originalPath = safeResolveInside(ORIGINALS_DIR, originalFilename);
  const previewPath = safeResolveInside(PREVIEWS_DIR, previewFilename);

  let durationSeconds = 0;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      originalPath,
    ]);
    durationSeconds = Math.max(1, Math.round(parseFloat(stdout.trim()) || 0));
  } catch {
    durationSeconds = 0;
  }

  try {
    // Extract a safe 12-second lower-bitrate preview clip (never exposing full original)
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', originalPath,
      '-t', '12',
      '-vf', 'scale=640:-2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      previewPath,
    ]);
    return { durationSeconds, generated: true };
  } catch {
    return { durationSeconds, generated: false };
  }
}

export function getFileSizeSafe(dir: string, filename: string): number {
  try {
    const p = safeResolveInside(dir, filename);
    if (fs.existsSync(p)) {
      return fs.statSync(p).size;
    }
  } catch {
    // ignore
  }
  return 0;
}

export function formatDurationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
