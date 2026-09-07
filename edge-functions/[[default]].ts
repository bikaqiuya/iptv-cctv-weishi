// EdgeOne Makers 边缘函数入口 - 通配路由捕获所有请求
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const kv = env.IPTV_KV; // 确保在 EdgeOne 控制台绑定了 KV 命名空间

  // 常量配置
  const CACHE_KEY = "iptv_cache_v5";
  const BLACKLIST_KEY = "url_blacklist";
  const CACHE_VERSION = "v5";
  const ORDERED_GROUPS = ["央视", "卫视", "地方", "互联网电影", "高清", "其他"];

  // ================= 路由分发 =================

  // 1. 根路径（返回生态湿地保护页面）
  if (path === "/") {
    return new Response("生态湿地保护页面", {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }

  // 2. 状态检查
  if (path === "/status") {
    let cached = null;
    try {
      const raw = await kv.get(CACHE_KEY, "json");
      if (raw) cached = raw;
    } catch (e) {}

    const status = {
      version: CACHE_VERSION,
      cached: !!cached,
      updated_at: cached ? new Date(cached.updated_at).toISOString() : null,
      endpoints: {
        m3u: "/iptv.m3u?key=xxx",
        group: "/group/央视.m3u?key=xxx",
        xtream_api: "/player_api.php?action=get_live_categories",
        report: "/report?key=xxx&url=xxx",
        epg: "/epg.xml"
      }
    };
    return new Response(JSON.stringify(status, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // 3. 强制刷新缓存
  if (path === "/refresh") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    
    // 此处省略实际的 fetchAndBuild 逻辑，按需重新拉取源并写入 KV
    try {
      await kv.put(CACHE_KEY, JSON.stringify({ updated_at: Date.now() }));
    } catch (e) {}
    return new Response("Refreshed", { status: 200 });
  }

  // 4. 坏链上报
  if (path === "/report") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    
    const badUrl = url.searchParams.get("url");
    if (!badUrl) return new Response("Invalid URL", { status: 400 });
    
    try {
      let bl = await kv.get(BLACKLIST_KEY, "json") || [];
      if (!bl.includes(badUrl)) {
        bl.push(badUrl);
        await kv.put(BLACKLIST_KEY, JSON.stringify(bl), { expirationTtl: 30 * 24 * 60 * 60 });
      }
    } catch (e) {}
    return new Response("Reported", { status: 200 });
  }

  // 5. 获取完整 M3U
  if (path === "/iptv.m3u") {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });

    let cached = null;
    try {
      cached = await kv.get(CACHE_KEY, "json");
    } catch (e) {}
    
    if (cached && cached.m3u) {
      return new Response(cached.m3u, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" }
      });
    }
    return new Response("Cache empty, please /refresh first", { status: 404 });
  }

  // 6. 获取分组 M3U (支持 /group/央视.m3u)
  if (path.startsWith("/group/")) {
    const key = url.searchParams.get("key");
    if (key !== env.AUTH_KEY) return new Response("Unauthorized", { status: 403 });
    
    const groupName = decodeURIComponent(path.replace("/group/", "").replace(".m3u", ""));
    let cached = null;
    try {
      cached = await kv.get(CACHE_KEY, "json");
    } catch (e) {}

    if (cached && cached.groups && cached.groups[groupName]) {
      const channels = cached.groups[groupName].join("\n");
      return new Response(`#EXTINF:-1,${groupName}\n${channels}`, {
        headers: { "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8" }
      });
    }
    return new Response("Group not found", { status: 404 });
  }

  // 7. Xtream Codes 兼容 API
  if (path === "/player_api.php") {
    const action = url.searchParams.get("action");
    if (action === "get_live_categories") {
      return new Response(JSON.stringify(ORDERED_GROUPS.map(name => ({ category_id: name, category_name: name }))), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // 8. EPG 代理
  if (path === "/epg.xml") {
    return new Response("<!-- EPG Proxy -->", {
      headers: { "Content-Type": "application/xml; charset=utf-8" }
    });
  }

  // 未匹配到任何路由
  return new Response("Not Found", { status: 404 });
}
