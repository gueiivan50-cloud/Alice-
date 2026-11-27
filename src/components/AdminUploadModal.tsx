import { ImagePlus, Pause, Play, RefreshCw, Upload, Video, X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import type { Category, VideoItem } from '../types.ts';
import { formatBytes } from '../utils/format.ts';

interface AdminUploadModalProps {
  token: string;
  accentColor: string;
  categories: Category[];
  editingVideo: VideoItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const CHUNK_SIZE = 512 * 1024; // 512 Ko optimal pour Android / reseaux mobiles

interface SavedUploadState {
  uploadId: string;
  fileSignature: string;
}

export function AdminUploadModal({
  token,
  accentColor,
  categories,
  editingVideo,
  onClose,
  onSaved,
}: AdminUploadModalProps) {
  const [title, setTitle] = useState(editingVideo?.title || '');
  const [description, setDescription] = useState(editingVideo?.description || '');
  const [categoryId, setCategoryId] = useState(editingVideo?.category_id || categories[0]?.id || '');
  const [priceFcfa, setPriceFcfa] = useState(
    editingVideo ? String(editingVideo.price_fcfa) : ''
  );
  const [promoPriceFcfa, setPromoPriceFcfa] = useState(
    editingVideo?.promo_price_fcfa ? String(editingVideo.promo_price_fcfa) : ''
  );
  const [durationLabel, setDurationLabel] = useState(editingVideo?.duration_label || '01:00');
  const [durationSeconds, setDurationSeconds] = useState(editingVideo?.duration_seconds || 60);
  const [posterUrl, setPosterUrl] = useState(
    editingVideo?.poster_url || '/src/assets/images/poster_tech_masterclass_1795722338907.jpg'
  );
  const [originalFilename, setOriginalFilename] = useState(editingVideo?.original_filename || '');
  const [previewFilename, setPreviewFilename] = useState(editingVideo?.preview_filename || '');

  const [isPublished, setIsPublished] = useState(editingVideo ? Boolean(editingVideo.is_published) : true);
  const [isFeatured, setIsFeatured] = useState(Boolean(editingVideo?.is_featured));
  const [isNew, setIsNew] = useState(editingVideo ? Boolean(editingVideo.is_new) : true);
  const [isBestseller, setIsBestseller] = useState(Boolean(editingVideo?.is_bestseller));

  // Resumable Upload States
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<
    'idle' | 'uploading' | 'paused' | 'completed' | 'error'
  >(editingVideo ? 'completed' : 'idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pausedRef = useRef(false);

  const [posterUploading, setPosterUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function uploadFileResumable(
    file: File,
    kind: 'original' | 'poster'
  ): Promise<{
    filename: string;
    publicUrl: string | null;
    autoPreviewFilename: string | null;
    durationSeconds: number;
    durationLabel: string;
  }> {
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const fileSignature = `${kind}:${file.name}:${file.size}:${file.lastModified}`;
    const storageKey = `cineveo_upload_${fileSignature}`;

    let savedUploadId: string | undefined;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedUploadState;
        if (parsed.fileSignature === fileSignature) {
          savedUploadId = parsed.uploadId;
        }
      }
    } catch {
      // ignore
    }

    const initResp = await fetch('/api/admin/uploads/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        uploadId: savedUploadId,
        filename: file.name,
        fileSize: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        kind,
      }),
    });

    if (!initResp.ok) {
      throw new Error('Impossible d’initialiser le transfert.');
    }

    const initData = (await initResp.json()) as {
      uploadId: string;
      uploadedChunks: number[];
    };

    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ uploadId: initData.uploadId, fileSignature })
      );
    } catch {
      // ignore
    }

    const doneSet = new Set<number>(initData.uploadedChunks);
    if (kind === 'original') {
      setUploadProgress(Math.round((doneSet.size / totalChunks) * 100));
    }

    for (let i = 0; i < totalChunks; i++) {
      if (doneSet.has(i)) continue;
      if (kind === 'original' && pausedRef.current) {
        throw new Error('PAUSED_BY_USER');
      }

      const start = i * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const blob = file.slice(start, end);

      const chunkResp = await fetch(
        `/api/admin/uploads/${encodeURIComponent(initData.uploadId)}/chunk/${i}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: `Bearer ${token}`,
          },
          body: blob,
        }
      );

      if (!chunkResp.ok) {
        throw new Error(`Échec de l’envoi du fragment ${i + 1}/${totalChunks}.`);
      }

      doneSet.add(i);
      if (kind === 'original') {
        setUploadProgress(Math.round((doneSet.size / totalChunks) * 100));
      }
    }

    const completeResp = await fetch(
      `/api/admin/uploads/${encodeURIComponent(initData.uploadId)}/complete`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!completeResp.ok) {
      const errData = (await completeResp.json()) as { error?: string };
      throw new Error(errData.error || 'Erreur lors de la finalisation du fichier.');
    }

    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }

    return (await completeResp.json()) as {
      filename: string;
      publicUrl: string | null;
      autoPreviewFilename: string | null;
      durationSeconds: number;
      durationLabel: string;
    };
  }

  async function startOrResumeVideoUpload(fileToUpload?: File) {
    const file = fileToUpload || selectedVideoFile;
    if (!file) return;

    pausedRef.current = false;
    setUploadStatus('uploading');
    setUploadError(null);

    try {
      const res = await uploadFileResumable(file, 'original');
      setOriginalFilename(res.filename);
      if (res.autoPreviewFilename) {
        setPreviewFilename(res.autoPreviewFilename);
      }
      if (res.durationSeconds > 0) {
        setDurationSeconds(res.durationSeconds);
        setDurationLabel(res.durationLabel);
      }
      setUploadProgress(100);
      setUploadStatus('completed');
    } catch (err) {
      if (err instanceof Error && err.message === 'PAUSED_BY_USER') {
        setUploadStatus('paused');
      } else {
        setUploadStatus('error');
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Importation interrompue. Appuyez sur Reprendre.'
        );
      }
    }
  }

  async function handlePosterFileChange(file: File | undefined) {
    if (!file) return;
    setPosterUploading(true);
    setFormError(null);
    try {
      const res = await uploadFileResumable(file, 'poster');
      if (res.publicUrl) {
        setPosterUrl(res.publicUrl);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur d’envoi de l’affiche.');
    } finally {
      setPosterUploading(false);
    }
  }

  async function handleSaveVideo(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!originalFilename) {
      setFormError('Veuillez d’abord importer le fichier vidéo depuis votre téléphone ou ordinateur.');
      return;
    }

    setSaving(true);
    try {
      const url = editingVideo
        ? `/api/admin/videos/${encodeURIComponent(editingVideo.id)}`
        : '/api/admin/videos';
      const method = editingVideo ? 'PUT' : 'POST';

      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          description,
          categoryId,
          durationSeconds,
          durationLabel,
          priceFcfa: Number(priceFcfa),
          promoPriceFcfa: promoPriceFcfa ? Number(promoPriceFcfa) : null,
          posterUrl,
          previewFilename: previewFilename || originalFilename,
          originalFilename,
          isPublished,
          isFeatured,
          isNew,
          isBestseller,
        }),
      });

      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        setFormError(data.error || 'Erreur lors de l’enregistrement.');
        return;
      }
      onSaved();
    } catch {
      setFormError('Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl bg-[#111116] border border-white/10 sm:rounded-2xl overflow-hidden my-auto max-h-screen sm:max-h-[92vh] flex flex-col">
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 bg-[#0D0D11] flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-white">
              {editingVideo ? 'Modifier la vidéo' : 'Importer une vidéo (Android & Bureau)'}
            </h2>
            <p className="text-xs text-zinc-400">
              Transfert fragmenté avec reprise automatique et protection du fichier original
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSaveVideo} className="overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Android Gallery Video Picker */}
          {!editingVideo && (
            <div className="p-4 rounded-xl bg-[#16161D] border border-white/10 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    1. Fichier vidéo original (Galerie Android / Ordinateur)
                  </p>
                  <p className="text-xs text-zinc-400">
                    Un aperçu sécurisé de 12s est généré automatiquement après l’envoi.
                  </p>
                </div>
                <label className="min-h-[44px] px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer whitespace-nowrap self-start">
                  <Video className="w-4 h-4" />
                  <span>Choisir une vidéo</span>
                  <input
                    type="file"
                    accept="video/*,.mp4,.mov,.webm"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setSelectedVideoFile(f);
                        startOrResumeVideoUpload(f);
                      }
                    }}
                  />
                </label>
              </div>

              {selectedVideoFile && (
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-200 truncate max-w-[65%]">
                      {selectedVideoFile.name} ({formatBytes(selectedVideoFile.size)})
                    </span>
                    <span className="font-mono tabular-nums text-white">{uploadProgress}%</span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden">
                    <div
                      className="h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%`, backgroundColor: accentColor }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {uploadStatus === 'uploading' && (
                      <button
                        type="button"
                        onClick={() => {
                          pausedRef.current = true;
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 text-xs text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Mettre en pause</span>
                      </button>
                    )}

                    {(uploadStatus === 'paused' || uploadStatus === 'error') && (
                      <button
                        type="button"
                        onClick={() => startOrResumeVideoUpload()}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Reprendre l’importation</span>
                      </button>
                    )}

                    {uploadStatus === 'completed' && (
                      <span className="text-xs text-emerald-400">
                        Fichier original sécurisé prêt ({originalFilename})
                      </span>
                    )}
                  </div>

                  {uploadError && <p className="text-xs text-rose-400">{uploadError}</p>}
                </div>
              )}
            </div>
          )}

          {/* Poster Upload */}
          <div className="p-4 rounded-xl bg-[#16161D] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src={posterUrl}
                alt="Affiche"
                className="w-12 h-16 rounded-lg object-cover bg-black border border-white/10 shrink-0"
              />
              <div>
                <p className="text-sm font-semibold text-white">2. Affiche de la vidéo</p>
                <p className="text-xs text-zinc-400">
                  Importez une image depuis votre galerie ou utilisez l’affiche par défaut.
                </p>
              </div>
            </div>

            <label className="min-h-[42px] px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer whitespace-nowrap self-start">
              {posterUploading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
              <span>{posterUploading ? 'Envoi...' : 'Importer une affiche'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePosterFileChange(e.target.files?.[0])}
              />
            </label>
          </div>

          {/* Metadata Fields */}
          <div className="space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-300">Titre de la vidéo *</span>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Documentaire Grand-Bassam"
                className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs text-zinc-300">Description *</span>
              <textarea
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Présentation détaillée de la vidéo..."
                className="w-full p-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="block space-y-1.5">
                <span className="text-xs text-zinc-300">Catégorie</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-zinc-300">Durée affichée</span>
                <input
                  type="text"
                  value={durationLabel}
                  onChange={(e) => setDurationLabel(e.target.value)}
                  placeholder="Ex. 45 min"
                  className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="block space-y-1.5">
                <span className="text-xs text-zinc-300">Votre prix de vente (FCFA) *</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={priceFcfa}
                  onChange={(e) => setPriceFcfa(e.target.value)}
                  placeholder="Fixez votre prix (ex. 2500)"
                  className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white font-mono placeholder:font-sans placeholder:text-zinc-500"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-zinc-300">Prix promotionnel (FCFA, optionnel)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={promoPriceFcfa}
                  onChange={(e) => setPromoPriceFcfa(e.target.value)}
                  placeholder="Laisser vide si aucune promo"
                  className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#09090C] border border-white/15 text-sm text-white font-mono placeholder:font-sans placeholder:text-zinc-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs text-zinc-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublished}
                  onChange={(e) => setIsPublished(e.target.checked)}
                />
                <span>Publiée</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isNew}
                  onChange={(e) => setIsNew(e.target.checked)}
                />
                <span>Nouveauté</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isBestseller}
                  onChange={(e) => setIsBestseller(e.target.checked)}
                />
                <span>Meilleure vente</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFeatured}
                  onChange={(e) => setIsFeatured(e.target.checked)}
                />
                <span>Bannière</span>
              </label>
            </div>
          </div>

          {formError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving || uploadStatus === 'uploading'}
              className="min-h-[44px] px-5 rounded-lg text-white text-xs font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              <Upload className="w-4 h-4" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer la vidéo'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
