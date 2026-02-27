/**
 * Cloudflare Worker: YouTube 자막 추출
 * InnerTube API 기반 (클라우드 IP에서도 동작)
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

const UA = "com.google.android.youtube/19.29.37 (Linux; U; Android 14)";

async function extractTranscript(videoId, langPriority) {
  const result = {
    success: false,
    video_id: videoId,
    language: null,
    is_generated: false,
    segments: [],
    full_text: "",
    error: null,
  };

  // 1. InnerTube API로 자막 트랙 정보 가져오기
  const playerRes = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "19.29.37",
            androidSdkVersion: 34,
            hl: "ko",
            gl: "KR",
          },
        },
        videoId: videoId,
      }),
    }
  );

  if (!playerRes.ok) {
    result.error = `YouTube API 요청 실패 (${playerRes.status})`;
    return result;
  }

  const playerData = await playerRes.json();

  const captionTracks =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    result.error = "이 영상에 사용 가능한 자막이 없습니다.";
    return result;
  }

  // 2. 언어 우선순위에 따라 자막 트랙 선택
  let selectedTrack = null;

  // 수동 자막 우선 (kind !== "asr")
  for (const lang of langPriority) {
    const manual = captionTracks.find(
      (t) => t.languageCode === lang && t.kind !== "asr"
    );
    if (manual) {
      selectedTrack = manual;
      result.is_generated = false;
      break;
    }
  }

  // 자동 생성 자막
  if (!selectedTrack) {
    for (const lang of langPriority) {
      const auto = captionTracks.find(
        (t) => t.languageCode === lang && t.kind === "asr"
      );
      if (auto) {
        selectedTrack = auto;
        result.is_generated = true;
        break;
      }
    }
  }

  // 아무 자막이나
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
    result.is_generated = selectedTrack.kind === "asr";
  }

  // 3. 자막 데이터 가져오기 (XML 형식 - 클라우드에서 가장 안정적)
  const captionUrl = selectedTrack.baseUrl;

  const captionRes = await fetch(captionUrl, {
    headers: { "User-Agent": UA },
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
  if (!result.success) result.error = "자막 데이터가 비어있습니다.";

  return result;
}

function parseXml(xml) {
  const segments = [];

  // <p t="1360" d="1680">텍스트</p> 형태 (InnerTube API)
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

  // <text start="0.0" dur="2.5">텍스트</text> 형태 (기존 방식)
  if (segments.length === 0) {
    const textRegex =
      /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/g;
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
