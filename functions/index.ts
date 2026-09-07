// ========== 工具函数 ==========

// 央视归一化
function normalizeCCTV(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^CCTV[-_ ]?(\d+)(\s*([\u4e00-\u9fa5]+))?/i);
  if (!m) return null;
  const num = m[1];
  const names: Record<string, string> = {
    "1": "综合", "2": "财经", "3": "综艺", "4": "中文国际",
    "5": "体育", "6": "电影", "7": "国防军事", "8": "电视剧",
    "9": "纪录", "10": "科教", "11": "戏曲", "12": "社会与法",
    "13": "新闻", "14": "少儿", "15": "音乐", "16": "奥林匹克", "17": "4K 超高清"
  };
  const suffix = m[3] ? m[3] : (names[num] || "");
  return `CCTV-${num}${suffix ? " " + suffix : ""}`;
}

// 卫视归一化
function normalizeSatellite(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^([\u4e00-\u9fa5]{2,4})\s*卫视/i);
  return m ? `${m[1]}卫视` : null;
}

// 新分类匹配：返回该频道应归属的所有"附加分类"
function matchExtraCategories(name: string): string[] {
  const n = name.toLowerCase();
  const categories: string[] = [];

  // 少儿：少儿 / 儿童 / kids
  if (/少儿|儿童|kids/.test(n)) {
    categories.push("少儿");
  }

  // 音乐：音乐 / music
  if (/音乐|music/.test(n)) {
    categories.push("音乐");
  }

  // 动漫：动漫 / 动画 / 卡通 / anime / comic
  // 注意：金鹰卡通、卡酷卡通等"卡通"后缀少儿频道也归到动漫
  if (/动漫|动画|卡通|anime|comic/.test(n)) {
    categories.push("动漫");
  }

  // 戏曲：戏曲 / 京剧 / 越剧 / 黄梅戏 / 梨园
  if (/戏曲|京剧|越剧|黄梅戏|豫剧|昆曲|梨园/.test(n)) {
    categories.push("戏曲");
  }

  return categories;
}

// 主分组判定（央视 / 卫视 / 其他）
function getMainGroup(name: string): { keep: boolean; std: string; group: string } {
  const cctv = normalizeCCTV(name);
  if (cctv) return { keep: true, std: cctv, group: "央视" };
  const sat = normalizeSatellite(name);
  if (sat) return { keep: true, std: sat, group: "卫视" };
  return { keep: false, std: "", group: "" };
}

// ========== 拉取源 + 聚合（支持多分组） ==========

async function fetchAndBuild(sources: string[], epgUrl: string): Promise<string> {
  // groups[分类名][标准频道名] = Set<url>
  const groups: Record<string, Record<string, Set<string>>> = {};

  function addToGroup(group: string, stdName: string, url: string) {
    if (!groups[group]) groups[group] = {};
    if (!groups[group][stdName]) groups[group][stdName] = new Set();
    groups[group][stdName].add(url);
  }

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
    let curGroupFromSrc = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF")) {
        const commaIdx = trimmed.indexOf(",");
        curName = commaIdx >= 0 ? trimmed.substring(commaIdx + 1).trim() : "";
        const grpMatch = trimmed.match(/group-title="([^"]*)"/i);
        curGroupFromSrc = grpMatch ? grpMatch[1] : "";
        continue;
      }
      if (trimmed && !trimmed.startsWith("#") && curName) {
        const main = getMainGroup(curName);

        // 主分组判定：名称归一化 OR 源里 group-title 已标明
        const groupHint = /央视|CCTV/i.test(curGroupFromSrc) ? "央视" :
                          /卫视/i.test(curGroupFromSrc) ? "卫视" : "";

        let assignedMain = "";
        let stdName = curName;

        if (main.keep) {
          assignedMain = main.group;
          stdName = main.std;
        } else if (groupHint) {
          assignedMain = groupHint;
        }

        if (assignedMain) {
          // 1) 加入主分组（央视 / 卫视）
          addToGroup(assignedMain, stdName, trimmed);

          // 2) 额外分类（少儿 / 音乐 / 动漫 / 戏曲）
          const extras = matchExtraCategories(stdName);
          for (const cat of extras) {
            // 用标准频道名归到附加分类，保证同一频道多链接聚合
            addToGroup(cat, stdName, trimmed);
          }
        }

        curName = "";
      }
    }
  }

  // ========== 生成 M3U ==========
  let m3u = "#EXTM3U";
  if (epgUrl) m3u += ` url-tvg="${epgUrl}"`;
  m3u += "\n";

  // 分组顺序：央视 → 卫视 → 少儿 → 音乐 → 动漫 → 戏曲
  const orderedGroups = ["央视", "卫视", "少儿", "音乐", "动漫", "戏曲"];

  for (const g of orderedGroups) {
    const chanMap = groups[g];
    if (!chanMap) continue;

    // 频道名排序
    const chanNames = Object.keys(chanMap).sort((a, b) => a.localeCompare(b));

    for (const chan of chanNames) {
      for (const url of chanMap[chan]) {
        m3u += `#EXTINF:-1 tvg-name="${chan}" group-title="${g}",${chan}\n${url}\n`;
      }
    }
  }

  return m3u;
}

// ========== 伪装主页 ==========

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

  // 2. 订阅接口
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
    const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 小时

    // 读缓存
    let cached: { m3u: string; updated_at: number } | null = null;
    try {
      const raw = await kv.get(CACHE_KEY, "json");
      if (raw) cached = raw as any;
    } catch {}

    const now = Date.now();
    if (cached && (now - cached.updated_at) < CACHE_TTL) {
      return new Response(cached.m3u, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-cache",
        },
      });
    }

    // 重新生成
    const m3u = await fetchAndBuild(sources, epgUrl);

    // 写回 KV
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

  // 可选：手动刷新缓存接口 /refresh?key=xxx
  if (path === "/refresh") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });

    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList.join(",");
    const m3u = await fetchAndBuild(sources, epgUrl);

    try {
      await env.IPTV_KV.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: Date.now() }));
    } catch {}

    return new Response("Refreshed", { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
}
