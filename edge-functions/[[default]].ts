// edge-functions/[[default]].ts
// ========== 配置 ==========
const CACHE_VERSION = "v7"; // ★ 版本号+1，强制刷新缓存
const CACHE_KEY = `iptv_data_${CACHE_VERSION}`;
const EPG_CACHE_KEY = "epg_xml_data";
const BLACKLIST_KEY = "url_blacklist";
const CACHE_TTL = 12 * 60 * 60 * 1000;
const EPG_CACHE_TTL = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 12000;
const RATE_LIMIT = 20;

// ★ 高清排在最前，然后是央视、卫视
const ORDERED_GROUPS = ["高清", "央视", "卫视", "少儿", "音乐", "动漫", "戏曲", "纪录片", "体育", "电影", "新闻", "互联网动漫", "互联网电影", "互联网电视剧"];

// ========== 工具函数 ==========

function normalizeCCTV(name: string): string | null {
  const n = name.trim().toLowerCase().replace(/\s+/g, "");
  const m = n.match(/^cctv-?(\d{1,2})/);
  if (!m) return null;
  const num = parseInt(m[1]).toString();
  const names: Record<string, string> = {
    "1": "综合", "2": "财经", "3": "综艺", "4": "中文国际",
    "5": "体育", "6": "电影", "7": "国防军事", "8": "电视剧",
    "9": "纪录", "10": "科教", "11": "戏曲", "12": "社会与法",
    "13": "新闻", "14": "少儿", "15": "音乐", "16": "奥林匹克", "17": "4K 超高清"
  };
  const suffix = names[num] || "";
  return `CCTV-${num}${suffix ? " " + suffix : ""}`;
}

function normalizeSatellite(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^([\u4e00-\u9fa5]{2,4})\s*卫视/);
  return m ? `${m[1]}卫视` : null;
}

function standardizeName(name: string, aliasMap: Map<string, string>): string {
  const cctv = normalizeCCTV(name);
  if (cctv) return cctv;
  const sat = normalizeSatellite(name);
  if (sat) return sat;
  const trimmed = name.trim();
  if (aliasMap.has(trimmed)) return aliasMap.get(trimmed)!;
  return trimmed;
}

function matchExtraCategories(name: string): string[] {
  const n = name.toLowerCase();
  const categories: string[] = [];
  if (/少儿|儿童|kids|卡通|动画|动漫/.test(n)) categories.push("少儿");
  if (/音乐|music|mtv|演唱会|音乐会/.test(n)) categories.push("音乐");
  if (/戏曲|京剧|越剧|黄梅戏|豫剧|昆曲|梨园|戏剧|曲苑/.test(n)) categories.push("戏曲");
  if (/纪录|纪录片|纪实|探索|动物|自然|历史|地理|discovery|国家地理/.test(n)) categories.push("纪录片");
  if (/体育|足球|篮球|nba|cctv-?5|赛事|sports|网球|乒乓球|羽毛球/.test(n)) categories.push("体育");
  if (/电影|影院|剧场版|film|movie|cinema|cctv-?6/.test(n)) categories.push("电影");
  if (/新闻|资讯|news|cctv-?13|时事/.test(n)) categories.push("新闻");
  if (/hd|2k|4k|高清|超清|蓝光|uhd|fhd|hdr|hevc|h265/.test(n)) categories.push("高清");
  if (/动漫|anime|comic|番|二次元|漫画/.test(n)) categories.push("动漫");
  return categories;
}

function matchInternetCategory(name: string): string | null {
  const n = name.toLowerCase();
  if (/频道|电视台|tv$|radio/i.test(n)) return null;
  if (/第.{1,4}集|集$|连载|更新至|ep\d+|s\d+e\d+|season|剧集/.test(n)) {
    if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) return "互联网动漫";
    return "互联网电视剧";
  }
  if (/动漫|动画|卡通|anime|comic|番|二次元|漫画/.test(n)) return "互联网动漫";
  if (/电影|影院|剧场版|film|movie|cinema/.test(n)) return "互联网电影";
  if (/^[\u4e00-\u9fa5]{2,15}$/.test(name)) return "互联网电影";
  return null;
}

function getLogo(chanName: string): string {
  const cctvMatch = chanName.match(/^CCTV-(\d+)/);
  if (cctvMatch) return `https://live.fanmingming.cn/tv/CCTV-${cctvMatch[1]}.png`;
  const satMatch = chanName.match(/^([\u4e00-\u9fa5]{2,4})卫视/);
  if (satMatch) return `https://live.fanmingming.cn/tv/${satMatch[1]}卫视.png`;
  return `https://live.fanmingming.cn/tv/${chanName}.png`;
}

function isValidUrl(url: string): boolean {
  if (!url || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const hostname = u.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return false;
    if (hostname.startsWith("192.168.") || hostname.startsWith("10.") || hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) return false;
    return true;
  } catch { return false; }
}

function extractTags(name: string): { cleanName: string; tags: string[]; isHighDef: boolean } {
  const tagPattern = /\[([^\]]+)\]|\((4K|1080P|720P|HEVC|H265|H264|高清|超清|蓝光|HD|SD|UHD|FHD|HDR|杜比|DOLBY)\)/gi;
  const tags: string[] = [];
  let match;
  while ((match = tagPattern.exec(name)) !== null) {
    const tag = (match[1] || match[2] || match[0]).toUpperCase();
    tags.push(tag);
  }
  const cleanName = name.replace(tagPattern, "").replace(/\s+/g, " ").trim();
  const highDefTags = ["4K", "1080P", "HEVC", "H265", "高清", "超清", "蓝光", "HD", "UHD", "FHD", "HDR"];
  const isHighDef = tags.some(t => highDefTags.includes(t));
  return { cleanName, tags, isHighDef };
}

function filterM3U(m3u: string, filter: string): string {
  const lines = m3u.split("\n");
  const filtered: string[] = [];
  let keep = false;
  for (const line of lines) {
    if (line.startsWith("#EXTM3U")) { filtered.push(line); continue; }
    if (line.startsWith("#EXTINF")) {
      keep = line.includes(`group-title="${filter}"`);
      if (keep) filtered.push(line);
      continue;
    }
    if (keep && line.trim()) { filtered.push(line); keep = false; }
  }
  return filtered.join("\n");
}

// ========== 带超时的 fetch ==========
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// ========== 拉取源 + 聚合 ==========
async function fetchAndBuild(sources: string[], chanAlias: Map<string, string>, kv: any): Promise<{ m3u: string; apiData: any }> {
  let blacklist: Set<string> = new Set();
  try {
    const bl = await kv.get(BLACKLIST_KEY, "json");
    if (bl && Array.isArray(bl)) blacklist = new Set(bl);
  } catch {}

  const groups: Record<string, Record<string, Set<string>>> = {};
  const chanMeta: Record<string, { tvgId?: string; tvgLogo?: string; tvgShift?: string }> = {};

  function addToGroup(group: string, stdName: string, url: string) {
    if (!groups[group]) groups[group] = {};
    if (!groups[group][stdName]) groups[group][stdName] = new Set();
    groups[group][stdName].add(url);
  }

  const results = await Promise.all(
    sources.map(url => fetchWithTimeout(url, FETCH_TIMEOUT))
  );

  for (const text of results) {
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    let curName = "";
    let curTvgId = "";
    let curTvgLogo = "";
    let curTvgShift = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXTINF")) {
        const commaIdx = trimmed.indexOf(",");
        curName = commaIdx >= 0 ? trimmed.substring(commaIdx + 1).trim() : "";
        const idMatch = trimmed.match(/tvg-id="([^"]*)"/i);
        const logoMatch = trimmed.match(/tvg-logo="([^"]*)"/i);
        const shiftMatch = trimmed.match(/tvg-shift="([^"]*)"/i);
        curTvgId = idMatch ? idMatch[1] : "";
        curTvgLogo = logoMatch ? logoMatch[1] : "";
        curTvgShift = shiftMatch ? shiftMatch[1] : "";
        continue;
      }
      if (trimmed && !trimmed.startsWith("#") && curName) {
        if (blacklist.has(trimmed)) { curName = ""; continue; }
        if (!isValidUrl(trimmed)) { curName = ""; continue; }

        let finalName = standardizeName(curName, chanAlias);
        const { cleanName, isHighDef } = extractTags(finalName);
        finalName = cleanName;

        if (curTvgId || curTvgLogo || curTvgShift) {
          if (!chanMeta[finalName]) chanMeta[finalName] = {};
          if (curTvgId) chanMeta[finalName].tvgId = curTvgId;
          if (curTvgLogo && isValidUrl(curTvgLogo)) chanMeta[finalName].tvgLogo = curTvgLogo;
          if (curTvgShift) chanMeta[finalName].tvgShift = curTvgShift;
        }

        // ★★★ 分组优选逻辑（核心修改） ★★★
        let assignedGroup = "";
        const cctvMatch = finalName.match(/^CCTV-\d+/);
        const satMatch = finalName.match(/^[\u4e00-\u9fa5]{2,4}卫视/);

        if (isHighDef && (cctvMatch || satMatch)) {
          // 第一优先：央视高清、卫视高清 → 归入「高清」
          assignedGroup = "高清";
        } else if (cctvMatch) {
          // 第二优先：普通央视 → 归入「央视」
          assignedGroup = "央视";
        } else if (satMatch) {
          // 第三优先：普通卫视 → 归入「卫视」
          assignedGroup = "卫视";
        } else {
          // 其他情况
          const internetCat = matchInternetCategory(finalName);
          if (internetCat && ORDERED_GROUPS.includes(internetCat)) {
            assignedGroup = internetCat;
          } else if (isHighDef) {
            assignedGroup = "高清";
          }
        }

        // 无法归入白名单主分组 → 直接丢弃
        if (!assignedGroup || !ORDERED_GROUPS.includes(assignedGroup)) {
          curName = "";
          continue;
        }

        // 写入主分组
        addToGroup(assignedGroup, finalName, trimmed);

        // 额外分类匹配（对所有已保留频道生效）
        const extras = matchExtraCategories(finalName);
        for (const cat of extras) {
          if (ORDERED_GROUPS.includes(cat)) {
            addToGroup(cat, finalName, trimmed);
          }
        }

        curName = "";
      }
    }
  }

  // ===== 生成 M3U =====
  let m3u = "#EXTM3U\n";
  const urlFirstChan = new Map<string, string>();
  for (const g of ORDERED_GROUPS) {
    const chanMap = groups[g];
    if (!chanMap) continue;
    for (const chan of Object.keys(chanMap)) {
      for (const url of chanMap[chan]) {
        if (!urlFirstChan.has(url)) urlFirstChan.set(url, chan);
      }
    }
  }

  const cctvOrder = (a: string, b: string) => {
    const na = a.match(/CCTV-(\d+)/)?.[1] || "999";
    const nb = b.match(/CCTV-(\d+)/)?.[1] || "999";
    return parseInt(na) - parseInt(nb);
  };

  for (const g of ORDERED_GROUPS) {
    const chanMap = groups[g];
    if (!chanMap) continue;
    let chanNames = Object.keys(chanMap);
    if (g === "央视") chanNames.sort(cctvOrder);
    else chanNames.sort((a, b) => a.localeCompare(b));

    for (const chan of chanNames) {
      for (const url of chanMap[chan]) {
        if (urlFirstChan.get(url) !== chan) continue;
        const meta = chanMeta[chan] || {};
        const logo = meta.tvgLogo || getLogo(chan);
        const tvgIdAttr = meta.tvgId ? ` tvg-id="${meta.tvgId}"` : "";
        const tvgShiftAttr = meta.tvgShift ? ` tvg-shift="${meta.tvgShift}"` : "";
        const logoAttr = logo ? ` tvg-logo="${logo}"` : "";
        m3u += `#EXTINF:-1 tvg-name="${chan}"${tvgIdAttr}${tvgShiftAttr}${logoAttr} group-title="${g}",${chan}\n${url}\n`;
      }
    }
  }

  // ===== API 数据 =====
  const categories = ORDERED_GROUPS.map((g, i) => ({
    category_id: i + 1,
    category_name: g,
    parent_id: 0
  }));

  const streams: any[] = [];
  let streamId = 1;
  for (const g of ORDERED_GROUPS) {
    const chanMap = groups[g];
    if (!chanMap) continue;
    for (const chan of Object.keys(chanMap)) {
      for (const url of chanMap[chan]) {
        if (urlFirstChan.get(url) !== chan) continue;
        const meta = chanMeta[chan] || {};
        const logo = meta.tvgLogo || getLogo(chan);
        streams.push({
          num: streamId, name: chan, stream_type: "live", stream_id: streamId,
          stream_icon: logo, epg_channel_id: meta.tvgId || chan,
          category_id: ORDERED_GROUPS.indexOf(g) + 1, custom_sid: "", tv_archive: 0, direct_source: url
        });
        streamId++;
      }
    }
  }

  return { m3u, apiData: { categories, streams } };
}

// ========== 入口 ==========
export async function onRequest(context: any) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const kv = (typeof IPTV_KV !== 'undefined') ? IPTV_KV : env.IPTV_KV;
  if (!kv) return new Response("ERROR: IPTV_KV 未绑定", { status: 500 });

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateKey = `rate_${ip}`;
  try {
    const attempts = await kv.get(rateKey);
    if (attempts && parseInt(attempts) > RATE_LIMIT) return new Response("Rate limited", { status: 429 });
    await kv.put(rateKey, String((parseInt(attempts || "0") + 1)), { expirationTtl: 60 });
  } catch {}

  if (path === "/refresh") {
    try {
      const key = url.searchParams.get("key");
      if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });

      const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
      if (sources.length === 0) return new Response("ERROR: SOURCES 未配置", { status: 500 });

      const chanAlias = new Map<string, string>();
      const aliasStr = env.CHAN_ALIAS || "";
      if (aliasStr) {
        aliasStr.split(",").forEach((pair: string) => {
          const [from, to] = pair.split("=").map(s => s.trim());
          if (from && to) chanAlias.set(from, to);
        });
      }

      const result = await fetchAndBuild(sources, chanAlias, kv);
      await kv.put(CACHE_KEY, JSON.stringify({ ...result, updated_at: Date.now() }));
      return new Response("Refreshed OK", { status: 200 });
    } catch (err: any) {
      return new Response(`Refresh Error: ${err.message || err}`, { status: 500 });
    }
  }

  if (path === "/status") {
    try {
      let cached: any = null;
      try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw; } catch {}
      const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
      const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
      return new Response(JSON.stringify({
        version: CACHE_VERSION, cached: !!cached,
        updated_at: cached ? new Date(cached.updated_at).toISOString() : null,
        age_minutes: cached ? Math.floor((Date.now() - cached.updated_at) / 60000) : null,
        sources_count: sources.length, epg_sources: epgList, epg_proxy: "/epg.xml",
        groups: ORDERED_GROUPS,
      }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    } catch (err: any) {
      return new Response(`Status Error: ${err.message}`, { status: 500 });
    }
  }

  if (path === "/iptv.m3u") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    const sources = (env.SOURCES || "").split(",").map(s => s.trim()).filter(Boolean);
    if (sources.length === 0) return new Response("SOURCES not configured", { status: 500 });

    const chanAlias = new Map<string, string>();
    const aliasStr = env.CHAN_ALIAS || "";
    if (aliasStr) {
      aliasStr.split(",").forEach((pair: string) => {
        const [from, to] = pair.split("=").map(s => s.trim());
        if (from && to) chanAlias.set(from, to);
      });
    }

    let cached: any = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw; } catch {}
    const now = Date.now();
    const isFresh = cached && (now - (cached.updated_at || 0)) < CACHE_TTL;

    if (isFresh) return new Response(cached.m3u, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });

    if (cached) {
      const response = new Response(cached.m3u, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
      fetchAndBuild(sources, chanAlias, kv).then(result => {
        kv.put(CACHE_KEY, JSON.stringify({ ...result, updated_at: Date.now() })).catch(() => {});
      }).catch(() => {});
      return response;
    }

    const result = await fetchAndBuild(sources, chanAlias, kv);
    try { await kv.put(CACHE_KEY, JSON.stringify({ ...result, updated_at: now })); } catch {}
    return new Response(result.m3u, { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }

  if (path === "/epg.xml") {
    try {
      const cached = await kv.get(EPG_CACHE_KEY, "text");
      if (cached) return new Response(cached, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "max-age=21600" } });
    } catch {}
    const epgList = (env.EPG_URL || "").split(",").map(s => s.trim()).filter(Boolean);
    const epgUrl = epgList[0];
    if (!epgUrl) return new Response("<!-- No EPG -->", { headers: { "Content-Type": "application/xml" } });
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const r = await fetch(epgUrl, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      clearTimeout(timeoutId);
      if (r.ok) {
        const xmlText = await r.text();
        try { await kv.put(EPG_CACHE_KEY, xmlText, { expirationTtl: EPG_CACHE_TTL / 1000 }); } catch {}
        return new Response(xmlText, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "max-age=21600" } });
      }
    } catch {}
    return new Response("<!-- EPG fetch failed -->", { headers: { "Content-Type": "application/xml" } });
  }

  if (path === "/report") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    const badUrl = url.searchParams.get("url");
    if (!badUrl || !isValidUrl(badUrl)) return new Response("Invalid URL", { status: 400 });
    try {
      let bl: string[] = await kv.get(BLACKLIST_KEY, "json") || [];
      if (!bl.includes(badUrl)) { bl.push(badUrl); await kv.put(BLACKLIST_KEY, JSON.stringify(bl), { expirationTtl: 30 * 24 * 60 * 60 }); }
    } catch {}
    return new Response("Reported", { status: 200 });
  }

  if (path === "/player_api.php") {
    const action = url.searchParams.get("action");
    let cached: any = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw; } catch {}
    if (!cached) return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    if (action === "get_live_categories") return new Response(JSON.stringify(cached.apiData?.categories || []), { headers: { "Content-Type": "application/json" } });
    if (action === "get_live_streams") {
      const catId = parseInt(url.searchParams.get("category_id") || "0");
      const streams = cached.apiData?.streams || [];
      if (catId > 0) return new Response(JSON.stringify(streams.filter((s: any) => s.category_id === catId)), { headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(streams), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ user_info: { auth: 1, status: "Active" } }), { headers: { "Content-Type": "application/json" } });
  }

  const groupMatch = path.match(/^\/group\/(.+)\.m3u$/);
  if (groupMatch) {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    const groupName = decodeURIComponent(groupMatch[1]);
    let cached: any = null;
    try { const raw = await kv.get(CACHE_KEY, "json"); if (raw) cached = raw; } catch {}
    if (!cached) return new Response("Not cached", { status: 404 });
    return new Response(filterM3U(cached.m3u, groupName), { headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" } });
  }

  if (path === "/" || path === "/index.html") {
    return new Response(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>湿地生态保护中心</title></head>
<body style="font-family:sans-serif;background:#e8f5e9;color:#1b5e20;padding:40px;">
  <h1>🌿 湿地生态保护中心</h1>
  <p>每一片湿地都是生命的摇篮。</p>
</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return new Response("Not Found", { status: 404 });
}
