/**
 * Cloudflare Worker: YouTube 자막 추출
 * 방법 1: HTML 페이지 파싱 (가장 안정적)
 * 방법 2: InnerTube API fallback (ANDROID → IOS)
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const videoId = url.searchParams.get("v");
    const langStr = url.searchParams.get("lang") || "ko,en";
    const langPriority = langStr.split(",").map((l) => l.trim());

    if (!videoId) {
      return json({ success: false, error: "v parameter is required" }, 400);
    }

    try {
      const result = await extractTranscript(videoId, langPriority);
      return json(result);
    } catch (e) {
      return json({
        success: false,
        video_id: videoId,
        error: `자막 추출 중 오류 발생: ${e.message}`,
      });
    }
  },
};

async function extractTranscript(videoId, langPriority) {
  // 방법 1: YouTube 페이지 HTML에서 자막 정보 추출 (가장 안정적)
  const htmlResult = await tryHtmlExtract(videoId, langPriority);
  if (htmlResult.success) return htmlResult;

  // 방법 2: InnerTube API (ANDROID → IOS 순서)
  const clients = [
    {
      name: "ANDROID",
      ua: "com.google.android.youtube/19.44.38 (Linux; U; Android 14)",
      context: { clientName: "ANDROID", clientVersion: "19.44.38", androidSdkVersion: 34, hl: "ko", gl: "KR" },
    },
    {
      name: "IOS",
      ua: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)",
      context: { clientName: "IOS", clientVersion: "19.45.4", deviceMake: "Apple", deviceModel: "iPhone16,2", hl: "ko", gl: "KR" },
    },
  ];

  let lastError = htmlResult.error;

  for (const client of clients) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await tryInnerTube(videoId, langPriority, client);
        if (result.success) return result;
        lastError = result.error;
        if (!result.error?.includes("요청 실패")) break;
        if (attempt === 0) await sleep(300);
      } catch (e) {
        lastError = e.message;
      }
    }
  }

  return {
    success: false,
    video_id: videoId,
    language: null,
    is_generated: false,
    segments: [],
    full_text: "",
    error: lastError || "이 영상에 사용 가능한 자막이 없습니다.",
  };
}

// ── 방법 1: HTML 페이지 파싱 ──
async function tryHtmlExtract(videoId, langPriority) {
  const result = makeEmptyResult(videoId);

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });

    if (!pageRes.ok) {
      result.error = `YouTube 페이지 로딩 실패 (${pageRes.status})`;
      return result;
    }

    const html = await pageRes.text();

    // "captions": {...} 부분 추출
    const capsMatch = html.match(/"captions":\s*(\{.*?"captionTracks":\s*\[.*?\]\s*\})/s);
    if (!capsMatch) {
      result.error = "HTML에서 자막 정보를 찾을 수 없습니다.";
      return result;
    }

    // JSON 파싱을 위해 적절한 범위 추출
    let capsJson = null;
    try {
      // "captions":{...,"captionTracks":[...]} 에서 captionTracks 배열만 추출
      const trackMatch = capsMatch[1].match(/"captionTracks":\s*(\[.*?\])/s);
      if (trackMatch) {
        capsJson = JSON.parse(trackMatch[1]);
      }
    } catch (e) {
      // 더 넓은 범위로 재시도
      try {
        const broader = html.match(/"captionTracks":\s*(\[[\s\S]*?\])\s*[,}]/);
        if (broader) {
          capsJson = JSON.parse(broader[1]);
        }
      } catch (e2) {
        result.error = "자막 데이터 파싱 실패";
        return result;
      }
    }

    if (!capsJson || capsJson.length === 0) {
      result.error = "이 영상에 사용 가능한 자막이 없습니다.";
      return result;
    }

    return await fetchCaptionFromTracks(capsJson, langPriority, result);
  } catch (e) {
    result.error = `HTML 파싱 오류: ${e.message}`;
    return result;
  }
}

// ── 방법 2: InnerTube API ──
async function tryInnerTube(videoId, langPriority, client) {
  const result = makeEmptyResult(videoId);

  const playerRes = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.ua,
      },
      body: JSON.stringify({
        context: { client: client.context },
        videoId: videoId,
      }),
    }
  );

  if (!playerRes.ok) {
    result.error = `YouTube API 요청 실패 (${playerRes.status}) [${client.name}]`;
    return result;
  }

  const playerData = await playerRes.json();
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    result.error = `자막 트랙 없음 [${client.name}]`;
    return result;
  }

  return await fetchCaptionFromTracks(captionTracks, langPriority, result);
}

// ── 공통: 자막 트랙에서 텍스트 추출 ──
async function fetchCaptionFromTracks(captionTracks, langPriority, result) {
  let selectedTrack = null;

  // 수동 자막 우선
  for (const lang of langPriority) {
    const manual = captionTracks.find((t) => t.languageCode === lang && t.kind !== "asr");
    if (manual) { selectedTrack = manual; result.is_generated = false; break; }
  }

  // 자동 생성 자막
  if (!selectedTrack) {
    for (const lang of langPriority) {
      const auto = captionTracks.find((t) => t.languageCode === lang && t.kind === "asr");
      if (auto) { selectedTrack = auto; result.is_generated = true; break; }
    }
  }

  // 아무 자막이나
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
    result.is_generated = selectedTrack.kind === "asr";
  }

  // 자막 XML 가져오기
  const captionRes = await fetch(selectedTrack.baseUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!captionRes.ok) {
    result.error = `자막 데이터 로딩 실패 (${captionRes.status})`;
    return result;
  }

  const captionText = await captionRes.text();

  if (!captionText || captionText.length < 10) {
    result.error = "자막 데이터가 비어있습니다.";
    return result;
  }

  result.segments = parseXml(captionText);
  result.language = selectedTrack.languageCode;
  result.full_text = result.segments.map((s) => s.text).join("\n");
  result.success = result.segments.length > 0;
  if (!result.success) result.error = "자막 파싱 결과가 비어있습니다.";

  return result;
}

function makeEmptyResult(videoId) {
  return {
    success: false,
    video_id: videoId,
    language: null,
    is_generated: false,
    segments: [],
    full_text: "",
    error: null,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseXml(xml) {
  const segments = [];

  // <p t="1360" d="1680">텍스트</p> (InnerTube)
  const pRegex = /<p\s+t="([^"]*)"(?:\s+d="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[3]).trim();
    if (!text) continue;
    segments.push({
      start: round((parseFloat(match[1]) || 0) / 1000, 2),
      duration: round((parseFloat(match[2]) || 0) / 1000, 2),
      text: text,
    });
  }

  // <text start="0.0" dur="2.5">텍스트</text> (timedtext)
  if (segments.length === 0) {
    const textRegex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;
    while ((match = textRegex.exec(xml)) !== null) {
      const text = decodeXmlEntities(match[3]).trim();
      if (!text) continue;
      segments.push({
        start: round(parseFloat(match[1]) || 0, 2),
        duration: round(parseFloat(match[2]) || 0, 2),
        text: text,
      });
    }
  }

  return segments;
}

function decodeXmlEntities(str) {
  return str
    .replace(/<s[^>]*>/g, "")
    .replace(/<\/s>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, " ");
}

function round(num, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
