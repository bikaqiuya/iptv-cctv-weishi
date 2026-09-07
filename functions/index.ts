// 央视规范化：把 cctv1 / CCTV-1 / cctv1综合 / CCTV-1综合 统一成 "CCTV-1 综合"
function normalizeCCTV(name: string): string | null {
  const n = name.trim();
  // 匹配 CCTV 后跟数字，可能有 - 或没有
  const m = n.match(/^CCTV[-_ ]?(\d+)(\s*([\u4e00-\u9fa5]+))?/i);
  if (!m) return null;
  const num = m[1];
  // 根据频道号补全标准名称
  const names: Record<string, string> = {
    "1": "综合", "2": "财经", "3": "综艺", "4": "中文国际",
    "5": "体育", "6": "电影", "7": "国防军事", "8": "电视剧",
    "9": "纪录", "10": "科教", "11": "戏曲", "12": "社会与法",
    "13": "新闻", "14": "音乐", "15": "少儿", "16": "奥林匹克",
    "17": "4K 超高清"
  };
  const suffix = m[3] ? m[3] : (names[num] || "");
  return `CCTV-${num}${suffix ? " " + suffix : ""}`;
}

// 卫视匹配：识别 "XX卫视" 或 "XX卫视HD" 等
function normalizeSatellite(name: string): string | null {
  const n = name.trim();
  const m = n.match(/^([\u4e00-\u9fa5]{2,4})\s*卫视/i);
  if (!m) return null;
  return `${m[1]}卫视`;
}

function isCCTVOrSat(name: string): { keep: boolean; std: string; group: string } {
  const cctv = normalizeCCTV(name);
  if (cctv) return { keep: true, std: cctv, group: "央视" };
  const sat = normalizeSatellite(name);
  if (sat) return { keep: true, std: sat, group: "卫视" };
  return { keep: false, std: "", group: "" };
}

export async function onRequest(context: any) {
  const env = context.env;
  const sources = (env.SOURCES || "").split("|").map(s => s.trim()).filter(Boolean);
  const epgUrl = env.EPG_URL || "";
  const ttl = parseInt(env.CACHE_TTL || "3600", 10);

  if (sources.length === 0) {
    return new Response("SOURCES env not set", { status: 500 });
  }

  // 并发拉取所有订阅源
  const results = await Promise.all(
    sources.map(async (url) => {
      try {
        const r = await fetch(url, { cf: { cacheTtl: ttl } });
        return r.ok ? await r.text() : "";
      } catch {
        return "";
      }
    })
  );

  // 逐行解析 M3U，聚合同一标准频道名的多链接
  const groups: Record<string, { group: string; urls: Set<string> }> = {};

  for (const text of results) {
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    let curName = "";
    let curGroup = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXTINF")) {
        // 提取 tvg-name 或逗号后的显示名
        const commaIdx = line.indexOf(",");
        curName = commaIdx >= 0 ? line.substring(commaIdx + 1).trim() : "";
        const grpMatch = line.match(/group-title="([^"]*)"/i);
        curGroup = grpMatch ? grpMatch[1] : "";
        continue;
      }
      if (line && !line.startsWith("#") && curName) {
        const url = line;
        const judge = isCCTVOrSat(curName);
        // 若 group-title 已明确标注央视/卫视，也纳入
        const groupHint = /央视|CCTV/i.test(curGroup) ? "央视" :
                          /卫视/i.test(curGroup) ? "卫视" : "";
        if (judge.keep || groupHint) {
          const std = judge.std || curName;
          const grp = judge.group || groupHint;
          if (!groups[std]) groups[std] = { group: grp, urls: new Set() };
          groups[std].urls.add(url);
        }
        curName = "";
      }
    }
  }

  // 生成 M3U
  let m3u = "#EXTM3U";
  if (epgUrl) {
    m3u += ` url-tvg="${epgUrl}"`;
  }
  m3u += "\n";

  // 央视在前、卫视在后
  const cctvKeys = Object.keys(groups).filter(k => groups[k].group === "央视")
    .sort((a, b) => a.localeCompare(b));
  const satKeys = Object.keys(groups).filter(k => groups[k].group === "卫视")
    .sort((a, b) => a.localeCompare(b));

  for (const k of [...cctvKeys, ...satKeys]) {
    for (const url of groups[k].urls) {
      m3u += `#EXTINF:-1 tvg-name="${k}" group-title="${groups[k].group}",${k}\n${url}\n`;
    }
  }

  return new Response(m3u, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": `public, max-age=${ttl}`,
    },
  });
}
