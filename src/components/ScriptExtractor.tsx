import React, { useState } from 'react';

interface ScriptExtractorProps {
  apiKey: string;
  initialUrl?: string;
}

export const ScriptExtractor: React.FC<ScriptExtractorProps> = ({ apiKey, initialUrl }) => {
  const [url, setUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  
  // 만약 외부(Video Insights 등)에서 주소를 가지고 넘어온 경우 자동 실행
  React.useEffect(() => {
    if (initialUrl) {
      fetchTranscript();
    }
  }, [initialUrl]);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState<{title: string, author: string, thumbnail: string} | null>(null);

  const extractVideoId = (url: string) => {
    // Shorts, Mobile, etc.를 모두 포함하는 더 강력한 정규식
    const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regExp);
    return (match && match[1].length === 11) ? match[1] : null;
  };

  const fetchTranscript = async () => {
    if (!url.trim()) return;
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('유효한 유튜브 URL을 입력해주세요. (Shorts 포함)');
      return;
    }

    setLoading(true);
    setError('');
    setTranscript('');
    setVideoInfo(null);

    const APIFY_TOKEN = ''; // API 토큰을 여기에 입력하거나 환경변수를 사용하세요.
    
    try {
      // 1. 기본 정보 호출 (선택 사항)
      try {
        const infoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`);
        const infoData = await infoRes.json();
        if (infoData.items && infoData.items.length > 0) {
          const snippet = infoData.items[0].snippet;
          setVideoInfo({
            title: snippet.title,
            author: snippet.channelTitle,
            thumbnail: snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url
          });
        }
      } catch (e) {
        console.warn('YouTube API Info fetch failed');
      }

      // 2. pintostudio/youtube-transcript-scraper 호출
      const apifyUrl = `https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
      
      const payload = {
        "videoUrl": url,
        "targetLanguage": "ko" // 기본은 한국어 요청 (없으면 스크래퍼가 기본 자막 시도)
      };

      const response = await fetch(apifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`대본 추출 서비스 연결 실패 (상태코드: ${response.status})`);
      }

      const results = await response.json();
      console.log('Apify Raw Results:', results);

      if (!results || !Array.isArray(results) || results.length === 0) {
        throw new Error('분석 결과가 비어있습니다. 자막이 있는 영상인지 확인해주세요.');
      }

      let transcriptData: any[] = [];

      // 구조 1: 첫 번째 아이템 내부에 배열이 있는 경우 (문서 공식 구조)
      if (results[0].transcript && Array.isArray(results[0].transcript)) {
        transcriptData = results[0].transcript;
      } else if (results[0].searchResult && Array.isArray(results[0].searchResult)) {
        transcriptData = results[0].searchResult;
      } 
      // 구조 2: 결과 배열 자체가 자막 조각(segments)들인 경우
      else if (results.some(item => item.text || item.content)) {
        transcriptData = results;
      }
      // 구조 3: 그 외 다른 필드에 배열이 숨어있는 경우 탐색
      else {
        const itemWithArray = results.find(item => 
          Object.values(item).some(val => Array.isArray(val) && val.length > 0)
        );
        if (itemWithArray) {
          const foundArray = Object.values(itemWithArray).find(val => Array.isArray(val)) as any[];
          transcriptData = foundArray;
        }
      }

      if (transcriptData && transcriptData.length > 0) {
        const rawText = transcriptData
          .map((item: any) => item.text || item.content || item.transcript || '')
          .filter(t => typeof t === 'string' && t.trim().length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (rawText.length > 5) {
          // 마침표(.), 콤마(,), 물음표(?), 느낌표(!) 뒤에 줄바꿈 추가하여 가독성 향상
          const formattedText = rawText
            .replace(/([.?!,])\s*/g, '$1\n')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
          setTranscript(formattedText);
        } else {
          throw new Error('추출된 텍스트 내용이 너무 짧거나 유효하지 않습니다.');
        }
      } else {
        // 비상 수단: 전체 결과에서 텍스트 데이터 긁어모으기
        const emergencyRaw = results
          .map((item: any) => item.text || item.content || JSON.stringify(item))
          .join(' ')
          .replace(/<[^>]*>/g, '')
          .replace(/\{.*\}/g, '')
          .replace(/\s+/g, ' ')
          .trim();
          
        if (emergencyRaw.length > 100) {
           const formattedEmergency = emergencyRaw
             .replace(/([.?!,])\s*/g, '$1\n')
             .split('\n')
             .map(line => line.trim())
             .filter(line => line.length > 0)
             .join('\n');
           setTranscript(formattedEmergency);
        } else {
           throw new Error('이 영상에서 대본 데이터를 파싱할 수 없습니다. 자막이 비활성화된 영상일 수 있습니다.');
        }
      }

    } catch (err: any) {
      console.error('Apify Error Detailed:', err);
      setError(err.message || '대본 추출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript);
    alert('대본이 클립보드에 복사되었습니다.');
  };

  const handleDownload = () => {
    if (!transcript) return;
    const element = document.createElement("a");
    const file = new Blob([transcript], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    const fileName = videoInfo 
      ? `대본_${videoInfo.title.replace(/[^a-z0-9가-힣]/gi, '_')}.txt`
      : 'youtube_transcript.txt';
    element.download = fileName;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl md:text-3xl">description</span>
            유튜브 대본 추출
          </h2>
          <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
            유튜브 영상 링크를 입력하여 <span className="text-indigo-500 font-bold">대본(자막)을 순식간에 추출</span>합니다.<br />
            추출된 텍스트를 복사하거나 다운로드하여 콘텐츠 제작에 활용해 보세요.
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Input Area */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-indigo-500 transition-colors">
            <span className="material-symbols-outlined">link</span>
          </div>
          <input 
            type="text" 
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTranscript()}
            className="w-full pl-12 pr-32 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
          />
          <button 
            onClick={fetchTranscript}
            disabled={loading || !url}
            className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {loading ? (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-lg">auto_awesome</span>
            )}
            추출하기
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold animate-in fade-in zoom-in-95">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {/* Result Area */}
        {videoInfo && (
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex gap-4 animate-in slide-in-from-bottom-2">
            <img src={videoInfo.thumbnail} alt="Thumbnail" className="w-32 aspect-video object-cover rounded-lg shadow-md" />
            <div className="flex-1 min-w-0 py-1">
              <h4 className="text-base font-black text-slate-900 dark:text-white truncate mb-1">{videoInfo.title}</h4>
              <p className="text-sm text-slate-500 font-bold">{videoInfo.author}</p>
            </div>
          </div>
        )}

        {transcript && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center px-1">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">추출된 대본</h3>
              <div className="flex gap-2">
                <button 
                  onClick={handleCopy}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  복사하기
                </button>
                <button 
                  onClick={handleDownload}
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-indigo-100 dark:border-indigo-900/50"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  다운로드
                </button>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-black/40 rounded-2xl p-6 border border-slate-100 dark:border-slate-800/50 min-h-[300px] max-h-[500px] overflow-y-auto custom-scrollbar relative">
              <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                {transcript}
              </p>
            </div>
          </div>
        )}

        {!transcript && !loading && !error && (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem]">
            <div className="size-20 rounded-3xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-200 dark:text-slate-800">
              <span className="material-symbols-outlined text-5xl">text_snippet</span>
            </div>
            <div className="space-y-1">
              <p className="text-slate-600 dark:text-slate-300 font-black">추출할 영상을 입력해주세요</p>
              <p className="text-slate-400 text-xs font-medium">유튜브 URL을 입력하면 실시간으로 대본을 분석합니다.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
