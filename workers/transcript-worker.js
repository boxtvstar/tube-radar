/**
 * Cloudflare Worker: YouTube 자막 추출
 *
 * Cloudflare 대시보드 → Workers & Pages → Create → "transcript-api" →
 * 이 코드 붙여넣기 → Deploy
 */

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
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
  const result = {
    success: false,
    video_id: videoId,
    language: null,
    is_generated: false,
    segments: [],
    full_text: "",
    error: null,
  };

  // 1. YouTube 비디오 페이지 가져오기
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "ko,en;q=0.9",
    },
  });

  if (!pageRes.ok) {
    result.error = `YouTube 페이지 로딩 실패 (${pageRes.status})`;
    return result;
  }

  const html = await pageRes.text();

  // 2. ytInitialPlayerResponse에서 자막 트랙 추출
  const playerMatch = html.match(
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script)/s
  );
  if (!playerMatch) {
    result.error = "이 영상에서 자막 정보를 찾을 수 없습니다.";
    return result;
  }

  let playerResponse;
  try {
    playerResponse = JSON.parse(playerMatch[1]);
  } catch {
    result.error = "자막 데이터 파싱 실패";
    return result;
  }

  const captionTracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    result.error = "이 영상에 사용 가능한 자막이 없습니다.";
    return result;
  }

  // 3. 언어 우선순위에 따라 자막 트랙 선택
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

  // 4. 자막 데이터 가져오기 (JSON 형식)
  let captionUrl = selectedTrack.baseUrl;
  if (!captionUrl.includes("fmt=json3")) {
    captionUrl += (captionUrl.includes("?") ? "&" : "?") + "fmt=json3";
  }

  const captionRes = await fetch(captionUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!captionRes.ok) {
    result.error = `자막 데이터 로딩 실패 (${captionRes.status})`;
    return result;
  }

  const captionData = await captionRes.json();
  const events = captionData.events || [];

  // 5. 세그먼트 파싱
  const segments = [];
  for (const event of events) {
    if (!event.segs) continue;
    const text = event.segs
      .map((s) => s.utf8 || "")
      .join("")
      .trim();
    if (!text || text === "\n") continue;

    segments.push({
      start: round((event.tStartMs || 0) / 1000, 2),
      duration: round((event.dDurationMs || 0) / 1000, 2),
      text: text,
    });
  }

  result.language = selectedTrack.languageCode;
  result.segments = segments;
  result.full_text = segments.map((s) => s.text).join("\n");
  result.success = true;

  return result;
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
