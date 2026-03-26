import React, { useMemo, useState } from 'react';

interface VideoDownloaderProps {
  apiKey: string;
  onTrackUsage?: (type: 'search' | 'list', units: number, details: string) => void;
  onPreCheckQuota?: (estimatedCost: number) => Promise<void>;
}

interface ThumbnailVariant {
  key: string;
  label: string;
  size: string;
  url: string;
}

interface ThumbnailPreview {
  videoId: string;
  videoUrl: string;
  bestUrl: string;
  bestLabel: string;
  variants: ThumbnailVariant[];
}

const THUMBNAIL_PRESETS = [
  { key: 'maxresdefault', label: '최고화질', size: '1280x720' },
  { key: 'sddefault', label: '고화질', size: '640x480' },
  { key: 'hqdefault', label: '기본 HD', size: '480x360' },
  { key: 'mqdefault', label: '중간 화질', size: '320x180' },
  { key: 'default', label: '기본 화질', size: '120x90' },
] as const;

const extractVideoId = (value: string) => {
  const input = value.trim().replace(/[<>]/g, '');
  if (!input) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const parsed = new URL(input);
    const hostname = parsed.hostname.replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(hostname)) {
      const watchId = parsed.searchParams.get('v');
      if (watchId && /^[a-zA-Z0-9_-]{11}$/.test(watchId)) return watchId;

      const segments = parsed.pathname.split('/').filter(Boolean);
      const candidate = ['shorts', 'embed', 'live', 'v'].includes(segments[0] || '') ? segments[1] : null;
      return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }
  } catch {
    // malformed URL fallback
  }

  const fallbackMatch = input.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|live\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\\s]{11})/
  );
  return fallbackMatch?.[1] || null;
};

const buildThumbnailUrl = (videoId: string, preset: string) => `https://i.ytimg.com/vi/${videoId}/${preset}.jpg`;

const verifyThumbnail = (url: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= 120 && img.naturalHeight >= 90);
    img.onerror = () => resolve(false);
    img.src = url;
  });

const downloadImage = async (url: string, filename: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('download_failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

export const VideoDownloader: React.FC<VideoDownloaderProps> = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ThumbnailPreview | null>(null);

  const currentVideoId = useMemo(() => extractVideoId(url), [url]);

  const resolveThumbnail = async () => {
    if (!url.trim()) return;

    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('올바른 유튜브 영상 주소 또는 영상 ID를 입력해주세요.');
      setPreview(null);
      return;
    }

    setLoading(true);
    setError('');
    setPreview(null);

    try {
      const variants = THUMBNAIL_PRESETS.map((preset) => ({
        key: preset.key,
        label: preset.label,
        size: preset.size,
        url: buildThumbnailUrl(videoId, preset.key),
      }));

      let bestVariant: ThumbnailVariant | null = null;
      for (const variant of variants) {
        const ok = await verifyThumbnail(variant.url);
        if (ok) {
          bestVariant = variant;
          break;
        }
      }

      if (!bestVariant) {
        throw new Error('이 영상의 썸네일을 찾지 못했습니다.');
      }

      setPreview({
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        bestUrl: bestVariant.url,
        bestLabel: bestVariant.label,
        variants,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '썸네일을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-2">
        <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl md:text-3xl">download</span>
          Thumbnail Downloader
        </h2>
        <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
          유튜브 영상 주소를 넣으면 가능한 가장 높은 화질의 썸네일을 찾아서 바로 저장할 수 있습니다.
        </p>
      </div>

      <div className="max-w-5xl space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] p-5 md:p-6 space-y-5 shadow-sm">
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-indigo-500 transition-colors">
              <span className="material-symbols-outlined">link</span>
            </div>
            <input
              type="text"
              placeholder="https://www.youtube.com/watch?v=... 또는 영상 ID"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && resolveThumbnail()}
              className="w-full pl-12 pr-36 py-4 bg-slate-50 dark:bg-slate-950/60 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-inner"
            />
            <button
              onClick={resolveThumbnail}
              disabled={loading || !url.trim()}
              className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95"
            >
              {loading ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-lg">image_search</span>}
              썸네일 찾기
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-500/20">
              지원 형식: watch / youtu.be / shorts / live / embed / 영상 ID
            </span>
            {currentVideoId && (
              <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                영상 ID {currentVideoId}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold animate-in fade-in zoom-in-95">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {preview && (
          <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] overflow-hidden shadow-sm">
              <div className="relative bg-black">
                <img src={preview.bestUrl} alt="thumbnail preview" className="w-full aspect-video object-cover" />
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-black">
                  {preview.bestLabel}
                </div>
              </div>
              <div className="p-5 md:p-6 space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-slate-400 font-black mb-1">Preview</p>
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300 break-all">{preview.videoUrl}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      const bestVariant = preview.variants.find((variant) => variant.url === preview.bestUrl);
                      const sizeLabel = bestVariant?.size || 'thumbnail';
                      downloadImage(preview.bestUrl, `youtube-thumbnail-${preview.videoId}-${sizeLabel}.jpg`);
                    }}
                    className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined">download</span>
                    최고 화질 저장
                  </button>
                  <a
                    href={preview.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-5 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-black transition-all flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined">open_in_new</span>
                    영상 보기
                  </a>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2rem] p-5 md:p-6 shadow-sm space-y-4">
              <div>
                <p className="text-[11px] uppercase tracking-widest text-slate-400 font-black mb-1">Available Sizes</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">해상도별 썸네일 저장</h3>
              </div>
              <div className="space-y-3">
                {preview.variants.map((variant) => (
                  <div key={variant.key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 dark:text-white">{variant.label}</p>
                      <p className="text-[11px] font-medium text-slate-400 truncate">{variant.size}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={variant.url}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl text-xs font-black bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
                      >
                        미리보기
                      </a>
                      <button
                        onClick={() => downloadImage(variant.url, `youtube-thumbnail-${preview.videoId}-${variant.size}.jpg`)}
                        className="px-3 py-2 rounded-xl text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-dashed border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5 p-4">
                <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  YouTube에 `maxresdefault`가 없는 영상은 자동으로 다음 화질로 내려갑니다. 그래서 항상 가능한 가장 높은 화질을 먼저 잡습니다.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
