// ========== 配置 ==========
const CACHE_VERSION = "v3";
const CACHE_KEY = `iptv_data_${CACHE_VERSION}`;
const CACHE_TTL = 12 * 60 * 60 * 1000;       // 12小时
const FETCH_TIMEOUT = 8000;                    // 单源8秒超时
const RATE_LIMIT = 20;                         // IP限流阈值

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

// 附加分类匹配
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

// 互联网影视分类
function matchInternetCategory(name: string): string | null {
  const n = name.toLowerCase();

  if (/频道|电视台|tv$|radio/i.test(n)) return null;

  if (/第.{1,4}集|集$|连载|更新至|ep\d+|s\d+e\d+|season|剧集/.test(n)) {
    if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) {
      return "互联网动漫";
    }
    return "互联网电视剧";
  }

  if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) {
    return "互联网动漫";
  }

  if (/电影|影院|剧场版|film|movie|cinema/.test(n)) {
    return "互联网电影";
  }

  if (/^[\u4e00-\u9fa5]{2,15}$/.test(name)) {
    return "互联网电影";
  }

  return null;
}

// 主分组判定
function getMainGroup(name: string): { keep: boolean; std: string; group: string } {
  const cctv = normalizeCCTV(name);
  if (cctv) return { keep: true, std: cctv, group: "央视" };
  const sat = normalizeSatellite(name);
  if (sat) return { keep: true, std: sat, group: "卫视" };
  return { keep: false, std: "", group: "" };
}

// 获取频道logo
function getLogo(chanName: string): string {
  const cctvMatch = chanName.match(/^CCTV-(\d+)/);
  if (cctvMatch) {
    return `https://live.fanmingming.cn/tv/CCTV-${cctvMatch[1]}.png`;
  }
  const satMatch = chanName.match(/^([\u4e00-\u9fa5]{2,4})卫视/);
  if (satMatch) {
    return `https://live.fanmingming.cn/tv/${satMatch[1]}卫视.png`;
  }
  return "";
}

// M3U过滤器
function filterM3U(m3u: string, filter: string): string {
  const lines = m3u.split("\n");
  const filtered: string[] = [];
  let keep = false;
  for (const line of lines) {
    if (line.startsWith("#EXTM3U")) {
      filtered.push(line);
      continue;
    }
    if (line.startsWith("#EXTINF")) {
      keep = line.includes(`group-title="${filter}"`);
      if (keep) filtered.push(line);
      continue;
    }
    if (keep && line.trim()) {
      filtered.push(line);
      keep = false;
    }
  }
  return filtered.join("\n");
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        const r = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        clearTimeout(timeoutId);
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

  // 生成 M3U
  let m3u = "#EXTM3U";
  if (epgUrl) m3u += ` url-tvg="${epgUrl}"`;
  m3u += "\n";

  const orderedGroups = ["央视", "卫视", "高清", "少儿", "音乐", "动漫", "戏曲", "纪录片", "互联网动漫", "互联网电影", "互联网电视剧"];

  // 央视数字排序
  const cctvOrder = (a: string, b: string) => {
    const na = a.match(/CCTV-(\d+)/)?.[1] || "999";
    const nb = b.match(/CCTV-(\d+)/)?.[1] || "999";
    return parseInt(na) - parseInt(nb);
  };

  for (const g of orderedGroups) {
    const chanMap = groups[g];
    if (!chanMap) continue;
    let chanNames = Object.keys(chanMap);
    if (g === "央视") {
      chanNames.sort(cctvOrder);
    } else {
      chanNames.sort((a, b) => a.localeCompare(b));
    }
    for (const chan of chanNames) {
      for (const url of chanMap[chan]) {
        const logo = getLogo(chan);
        const logoAttr = logo ? ` tvg-logo="${logo}"` : "";
        m3u += `#EXTINF:-1 tvg-name="${chan}"${logoAttr} group-title="${g}",${chan}\n${url}\n`;
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
  const kv = env.IPTV_KV;

  // ===== IP限流 =====
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateKey = `rate_${ip}`;
  try {
    const attempts = await kv.get(rateKey);
    if (attempts && parseInt(attempts) > RATE_LIMIT) {
      return new Response("Rate limited", { status: 429 });
    }
    await kv.put(rateKey, String((parseInt(attempts || "0") + 1)), { expirationTtl: 60 });
  } catch {}

  if (path === "/" || path === "/index.html") {
    return new Response(HTML_HOME, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (path === "/iptv.m3u") {
    const key = url.searchParams.get("key");
    const authKey = env.AUTH_KEY;
    if (!authKey || key !== authKey) return new Response("Unauthorized", { status: 403 });

    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList[0] || ""; // 只取第一个EPG源
    if (sources.length === 0) return new Response("SOURCES not configured", { status: 500 });

    const filter = url.searchParams.get("filter");

    // ===== 缓存读取 =====
    let cached: { m3u: string; updated_at: number } | null = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw as any; } catch {}

    const now = Date.now();

    // 缓存有效
    if (cached && (now - cached.updated_at) < CACHE_TTL) {
      let output = cached.m3u;
      if (filter) output = filterM3U(output, filter);
      return new Response(output, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
    }

    // 缓存过期 → Stale-While-Revalidate：先返回旧数据，后台刷新
    if (cached && (now - cached.updated_at) >= CACHE_TTL) {
      let output = cached.m3u;
      if (filter) output = filterM3U(output, filter);
      const response = new Response(output, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });

      // 后台异步刷新（不阻塞返回）
      fetchAndBuild(sources, epgUrl).then(m3u => {
        kv.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: Date.now() })).catch(() => {});
      }).catch(() => {});

      return response;
    }

    // 无缓存 → 同步构建
    const m3u = await fetchAndBuild(sources, epgUrl);
    try { await kv.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: now })); } catch {}
    let output = m3u;
    if (filter) output = filterM3U(output, filter);
    return new Response(output, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }

  if (path === "/refresh") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList[0] || "";
    const m3u = await fetchAndBuild(sources, epgUrl);
    try { await kv.put(CACHE_KEY, JSON.stringify({ m3u, updated_at: Date.now() })); } catch {}
    return new Response("Refreshed", { status: 200 });
  }

  if (path === "/status") {
    let cached: { m3u: string; updated_at: number } | null = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw as any; } catch {}
    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);

    const status = {
      version: CACHE_VERSION,
      cached: !!cached,
      updated_at: cached ? new Date(cached.updated_at).toISOString() : null,
      age_minutes: cached ? Math.floor((Date.now() - cached.updated_at) / 60000) : null,
      sources_count: sources.length,
      epg_sources: epgList,
      active_epg: epgList[0] || "none",
      groups: ["央视", "卫视", "高清", "少儿", "音乐", "动漫", "戏曲", "纪录片", "互联网动漫", "互联网电影", "互联网电视剧"]
    };

    return new Response(JSON.stringify(status, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  return new Response("Not Found", { status: 404 });
}
