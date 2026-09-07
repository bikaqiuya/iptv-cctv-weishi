// ========== 工具函数：央视/卫视归一化（同上版，略作精简） ==========

function normalizeCCTV(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^CCTV[-_ ]?(\d+)(\s*([\u4e00-\u9fa5]+))?/i);
  if (!m) return null;
  const num = m[1];
  const names: Record<string, string> = {
    "1": "综合", "2": "财经", "3": "综艺", "4": "中文国际",
    "5": "体育", "6": "电影", "7": "国防军事", "8": "电视剧",
    "9": "纪录", "10": "科教", "11": "戏曲", "12": "社会与法",
    "13": "新闻", "14": "音乐", "15": "少儿", "16": "奥林匹克", "17": "4K 超高清"
  };
  const suffix = m[3] ? m[3] : (names[num] || "");
  return `CCTV-${num}${suffix ? " " + suffix : ""}`;
}

function normalizeSatellite(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^([\u4e00-\u9fa5]{2,4})\s*卫视/i);
  return m ? `${m[1]}卫视` : null;
}

function isCCTVOrSat(name: string): { keep: boolean; std: string; group: string } {
  const cctv = normalizeCCTV(name);
  if (cctv) return { keep: true, std: cctv, group: "央视" };
  const sat = normalizeSatellite(name);
  if (sat) return { keep: true, std: sat, group: "卫视" };
  return { keep: false, std: "", group: "" };
}

// ========== 核心：拉取源 + 聚合 ==========

async function fetchAndBuild(sources: string[], epgUrl: string): Promise<string> {
  const groups: Record<string, { group: string; urls: Set<string> }> = {};

  const results = await Promise.all(
    sources.map(async (url) => {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    })
  );

  for (const text of results) {
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    let curName = "";
    let curGroup = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF")) {
        const commaIdx = trimmed.indexOf(",");
        curName = commaIdx >= 0 ? trimmed.substring(commaIdx + 1).trim() : "";
        const grpMatch = trimmed.match(/group-title="([^"]*)"/i);
        curGroup = grpMatch ? grpMatch[1] : "";
        continue;
      }
      if (trimmed && !trimmed.startsWith("#") && curName) {
        const judge = isCCTVOrSat(curName);
        const groupHint = /央视|CCTV/i.test(curGroup) ? "央视" : /卫视/i.test(curGroup) ? "卫视" : "";
        if (judge.keep || groupHint) {
          const std = judge.std || curName;
          const grp = judge.group || groupHint;
          if (!groups[std]) groups[std] = { group: grp, urls: new Set() };
          groups[std].urls.add(trimmed);
        }
        curName = "";
      }
    }
  }

  let m3u = "#EXTM3U";
  if (epgUrl) m3u += ` url-tvg="${epgUrl}"`;
  m3u += "\n";

  const cctvKeys = Object.keys(groups).filter(k => groups[k].group === "央视").sort();
  const satKeys = Object.keys(groups).filter(k => groups[k].group === "卫视").sort();

  for (const k of [...cctvKeys, ...satKeys]) {
    for (const url of groups[k].urls) {
      m3u += `#EXTINF:-1 tvg-name="${k}" group-title="${groups[k].group}",${k}\n${url}\n`;
    }
  }
  return m3u;
}

// ========== 伪装主页 HTML ==========

const HTML_HOME = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>影视资源导航</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 40px; }
    .container { max-width: 800px; margin: 0 auto; text-align: center; }
    h1 { font-size: 2.5em; margin-bottom: 0.5em; }
    p { color: #94a3b8; line-height: 1.8; }
    .card { background: #1e293b; border-radius: 12px; padding: 30px; margin-top: 30px; }
    .footer { margin-top: 40px; font-size: 0.85em; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎬 影视资源导航站</h1>
    <div class="card">
      <p>本站点提供优质的影视节目聚合服务。</p>
      <p>使用正版播放器，享受高清流畅的观看体验。</p>
    </div>
    <div class="footer">© 2026 IPTV Service | Powered by EdgeOne</div>
  </div>
</body>
</html>`;

// ========== 入口 ==========

export async function onRequest(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. 伪装主页
  if (path === "/" || path === "/index.html") {
    return new Response(HTML_HOME, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 2. 订阅接口：/iptv.m3u?key=xxx
  if (path === "/iptv.m3u") {
    const key = url.searchParams.get("key");
    const authKey = env.AUTH_KEY;

    if (!authKey || key !== authKey) {
      return new Response("Unauthorized", { status: 403 });
    }

    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList.join(",");

    if (sources.length === 0) {
      return new Response("SOURCES not configured", { status: 500 });
    }

    const kv = env.IPTV_KV;
    const CACHE_KEY = "iptv_data";
    const CACHE_TTL = 12 * 60 * 60 * 1000; // 12小时

    // 尝试读缓存
    let cached: { m3u: string; updated_at: number } | null = null;
    try {
      const raw = await kv.get(CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch {}

    const now = Date.now();
    if (cached && (now - cached.updated_at) < CACHE_TTL) {
      // 缓存有效，直接返回
      return new Response(cached.m3u, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache",
        },
      });
    }

    // 缓存过期或不存在，重新生成
    const m3u = await fetchAndBuild(sources, epgUrl);

    // 写入 KV（KV 本身没有 TTL 自动删除，靠时间戳逻辑控制）
    try {
      await kv.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: now }));
    } catch {}

    return new Response(m3u, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 3. 其他路径 404
  return new Response("Not Found", { status: 404 });
}
