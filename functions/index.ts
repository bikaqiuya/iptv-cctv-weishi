// ========== 工具函数 ==========

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

function normalizeSatellite(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^([\u4e00-\u9fa5]{2,4})\s*卫视/i);
  return m ? `${m[1]}卫视` : null;
}

function matchExtraCategories(name: string): string[] {
  const n = name.toLowerCase();
  const categories: string[] = [];

  if (/少儿|儿童|kids/.test(n)) categories.push("少儿");
  if (/音乐|music/.test(n)) categories.push("音乐");
  if (/动漫|动画|卡通|anime|comic/.test(n)) categories.push("动漫");
  if (/戏曲|京剧|越剧|黄梅戏|豫剧|昆曲|梨园/.test(n)) categories.push("戏曲");
  if (/纪录|纪录片|纪实|动物世界|人与自然|探索频道|discovery|国家地理|nat\s*geo|national\s*geographic/.test(n)) categories.push("纪录片");
  if (/hd|2k|4k|高清|超清|高画质|fhd|uhd|蓝光|blu-ray/.test(n)) categories.push("高清");

  return categories;
}

// ★ 更新：互联网影视分类（含动漫）
function matchInternetCategory(name: string): string | null {
  const n = name.toLowerCase();

  if (/频道|电视台|tv$|radio/i.test(n)) return null;

  // 有集数
  if (/第.{1,4}集|集$|连载|更新至|ep\d+|s\d+e\d+|season|剧集/.test(n)) {
    if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) {
      return "互联网动漫";
    }
    return "互联网电视剧";
  }

  // 动漫作品
  if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) {
    return "互联网动漫";
  }

  // 电影
  if (/电影|影院|剧场版|film|movie|cinema/.test(n)) {
    return "互联网电影";
  }

  // 兜底
  if (/^[\u4e00-\u9fa5]{2,15}$/.test(name)) {
    return "互联网电影";
  }

  return null;
}

function getMainGroup(name: string): { keep: boolean; std: string; group: string } {
  const cctv = normalizeCCTV(name);
  if (cctv) return { keep: true, std: cctv, group: "央视" };
  const sat = normalizeSatellite(name);
  if (sat) return { keep: true, std: sat, group: "卫视" };
  return { keep: false, std: "", group: "" };
}

// ========== 拉取源 + 聚合 ==========

async function fetchAndBuild(sources: string[], epgUrl: string): Promise<string> {
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
      } catch { return ""; }
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
          addToGroup(assignedMain, stdName, trimmed);
          const extras = matchExtraCategories(stdName);
          for (const cat of extras) {
            addToGroup(cat, stdName, trimmed);
          }
        } else {
          const internetCat = matchInternetCategory(curName);
          if (internetCat) {
            addToGroup(internetCat, curName, trimmed);
          }
        }

        curName = "";
      }
    }
  }

  let m3u = "#EXTM3U";
  if (epgUrl) m3u += ` url-tvg="${epgUrl}"`;
  m3u += "\n";

  const orderedGroups = ["央视", "卫视", "高清", "少儿", "音乐", "动漫", "戏曲", "纪录片", "互联网动漫", "互联网电影", "互联网电视剧"];

  for (const g of orderedGroups) {
    const chanMap = groups[g];
    if (!chanMap) continue;
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
  <title>湿地生态保护中心</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #e8f5e9; color: #1b5e20; margin: 0; padding: 40px; }
    .container { max-width: 800px; margin: 0 auto; text-align: center; }
    h1 { font-size: 2.5em; margin-bottom: 0.5em; color: #2e7d32; }
    p { color: #388e3c; line-height: 1.8; }
    .card { background: #c8e6c9; border-radius: 12px; padding: 30px; margin-top: 30px; border-left: 5px solid #4caf50; text-align: left; }
    .card ul { padding-left: 20px; }
    .card li { margin-bottom: 10px; }
    .footer { margin-top: 40px; font-size: 0.85em; color: #689f38; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌿 湿地生态保护中心</h1>
    <div class="card">
      <p>湿地被誉为<strong>"地球之肾"</strong>，是生物多样性最丰富的生态系统之一，也是候鸟迁徙的重要驿站。</p>
      <ul>
        <li>🌱 保护和恢复湿地植被，维护水陆交错带的生态平衡</li>
        <li>🦅 守护珍稀候鸟栖息地，保障迁徙通道安全</li>
        <li>💧 净化水质、蓄洪防旱，发挥湿地生态服务功能</li>
        <li>🔬 开展湿地科普教育，提升公众环保意识</li>
      </ul>
      <p>每一片湿地都是生命的摇篮。让我们携手行动，减少污染、保护生境，为子孙后代留下碧水蓝天、鸟语花香的美丽家园。</p>
    </div>
    <div class="footer">© 2026 湿地生态保护项目 | 共建人与自然和谐共生的美丽中国</div>
  </div>
</body>
</html>`;

// ========== 入口 ==========
export async function onRequest(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/" || path === "/index.html") {
    return new Response(HTML_HOME, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path === "/iptv.m3u") {
    const key = url.searchParams.get("key");
    const authKey = env.AUTH_KEY;
    if (!authKey || key !== authKey) return new Response("Unauthorized", { status: 403 });

    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList.join(",");
    if (sources.length === 0) return new Response("SOURCES not configured", { status: 500 });

    const kv = env.IPTV_KV;
    const CACHE_KEY = "iptv_data";
    const CACHE_TTL = 12 * 60 * 60 * 1000;

    let cached: { m3u: string; updated_at: number } | null = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw as any; } catch {}

    const now = Date.now();
    if (cached && (now - cached.updated_at) < CACHE_TTL) {
      return new Response(cached.m3u, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
    }

    const m3u = await fetchAndBuild(sources, epgUrl);
    try { await kv.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: now })); } catch {}
    return new Response(m3u, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }

  if (path === "/refresh") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList.join(",");
    const m3u = await fetchAndBuild(sources, epgUrl);
    try { await env.IPTV_KV.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: Date.now() })); } catch {}
    return new Response("Refreshed", { status: 200 });
  }

  return new Response("Not Found", { status: 404 });
}
