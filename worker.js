/**
 * Tencent Cloud EdgeOne Worker
 * 适配：KV 存储替代 D1 SQL
 */

// --- 常量配置 ---
const BASE_URL = "https://yktyd.ecust.edu.cn/epay/wxpage/wanxiao/eleresult";
const USER_AGENT = "Mozilla/5.0 (Linux; U; Android 4.1.2; zh-cn; Chitanda/Akari) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30 MicroMessenger/6.0.0.58_r884092.501 NetType/WIFI";
const REGEX = /(-?\d+(\.\d+)?)度/;

// 楼栋映射 (保持不变)
const BUILDING_MAP = {
    "奉贤1号楼":"1", "奉贤2号楼":"2", "奉贤3号楼":"3", "奉贤4号楼":"4",
    "奉贤5号楼":"27", "奉贤6号楼":"28", "奉贤7号楼":"29", "奉贤8号楼":"30",
    "奉贤9号楼":"31", "奉贤10号楼":"32", "奉贤11号楼":"33", "奉贤12号楼":"34",
    "奉贤13号楼":"35", "奉贤14号楼":"36", "奉贤15号楼":"37", "奉贤16号楼":"38",
    "奉贤17号楼":"39", "奉贤18号楼":"40", "奉贤19号楼":"41", "奉贤20号楼":"42",
    "奉贤21号楼":"43", "奉贤22号楼":"44", "奉贤23号楼":"45", "奉贤24号楼":"46",
    "奉贤25号楼":"49", "奉贤26号楼":"50", "奉贤27号楼":"51", "奉贤28号楼":"52",
    "奉贤后勤职工宿舍":"55",
    "徐汇1号楼":"64", "徐汇2号楼":"47", "徐汇3号楼":"5", "徐汇4号楼":"6",
    "徐汇5号楼":"7", "徐汇6号楼":"8", "徐汇7号楼":"9", "徐汇8号楼":"10",
    "徐汇9号楼":"11", "徐汇10号楼":"12", "徐汇11号楼":"13", "徐汇12号楼":"14",
    "徐汇13号楼":"15", "徐汇14号楼":"16", "徐汇15号楼":"17", "徐汇16号楼":"18",
    "徐汇17号楼":"19", "徐汇18号楼":"20", "徐汇19号楼":"21", "徐汇20号楼":"22",
    "徐汇21号楼":"23", "徐汇22号楼":"24", "徐汇23号楼":"25", "徐汇24号楼":"26",
    "徐汇25号楼":"48",
    "徐汇晨园公寓":"53", "徐汇励志公寓":"54",
    "徐汇南区第一宿舍楼":"66", "徐汇南区第二宿舍楼":"65",
    "徐汇南区第三宿舍楼":"67", "徐汇南区4A宿舍楼":"68", "徐汇南区4B宿舍楼":"69"
};
const SPECIAL_NAMES = {
    "后勤职工": "后勤职工宿舍",
    "晨园": "晨园公寓",
    "励志": "励志公寓",
    "南区1": "南区第一宿舍楼", "南区2": "南区第二宿舍楼",
    "南区3": "南区第三宿舍楼", "南区4A": "南区4A宿舍楼", "南区4B": "南区4B宿舍楼"
};

// --- 辅助函数 ---
function autoGenerateUrl(env) {
    const roomId = env.ROOM_ID;
    let partId = env.PART_ID; 
    const buildIdRaw = env.BUILD_ID;
    if (!roomId || !partId || !buildIdRaw) return null;

    let campusName = "", areaId = "";
    if (partId === "0" || partId === "奉贤") { campusName = "奉贤"; areaId = "2"; }
    else if (partId === "1" || partId === "徐汇") { campusName = "徐汇"; areaId = "3"; }
    else return null;

    let matchedBuildId = SPECIAL_NAMES[buildIdRaw] ? BUILDING_MAP[`${campusName}${SPECIAL_NAMES[buildIdRaw]}`] : (BUILDING_MAP[`${campusName}${buildIdRaw}号楼`] || BUILDING_MAP[`${campusName}${buildIdRaw}`]);
    if (!matchedBuildId) return null;
    return `${BASE_URL}?sysid=1&roomid=${roomId}&areaid=${areaId}&buildid=${matchedBuildId}`;
}

/**
 * 核心逻辑修改：使用 KV 存取数据
 * 数据结构: Key = `history_${roomId}`, Value = JSON Array of { timestamp, kWh, room_id }
 */
async function getHistoryFromKV(env, roomId) {
    try {
        const raw = await env.ELECTRIC_KV.get(`history_${roomId}`);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error("KV Read Error:", e);
        return [];
    }
}

async function saveHistoryToKV(env, roomId, newDataPoint) {
    try {
        let history = await getHistoryFromKV(env, roomId);
        
        // 去重：检查最后一条是否相同时间，如果很近则不存（可选）
        const exists = history.some(h => h.timestamp === newDataPoint.timestamp);
        if (!exists) {
            history.push(newDataPoint);
            
            // 数据保留策略：保留最近 30 天的数据 (假设每小时一条，约 720 条)
            // 为了安全起见保留最近 1000 条
            if (history.length > 1000) {
                history = history.slice(-1000);
            }
            
            await env.ELECTRIC_KV.put(`history_${roomId}`, JSON.stringify(history));
        }
    } catch (e) {
        console.error("KV Write Error:", e);
    }
}

async function scrape(env) {
    const roomId = env.ROOM_ID;
    if (!roomId) return { error: "ROOM_ID not set" };
    
    // 如果没有 ELECTRIC_KV 绑定，报错
    if (!env.ELECTRIC_KV) return { error: "KV binding missing" };

    let url = env.ROOM_URL || autoGenerateUrl(env);
    if (!url) url = `${BASE_URL}?sysid=1&areaid=3&buildid=20&roomid=${roomId}`;

    try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) return { error: `HTTP ${response.status}` };
        const text = await response.text();
        const match = text.match(REGEX);
        
        if (match && match[1]) {
            const kwh = parseFloat(match[1]);
            const timestamp = new Date().toISOString();
            
            // 写入 KV
            await saveHistoryToKV(env, roomId, {
                timestamp,
                room_id: roomId,
                kWh: kwh
            });
            
            return { success: true, kwh };
        }
        return { error: "Parse failed" };
    } catch (e) {
        return { error: e.message };
    }
}

// HTML 渲染函数 (保持不变，省略以节省空间，直接复制 Cloudflare 版本即可)
function renderHtml(result) {
    const isSuccess = result.success;
    const title = isSuccess ? "更新成功" : "更新失败";
    const colorClass = isSuccess ? "text-green-500 bg-green-500/10" : "text-red-500 bg-red-500/10";
    const icon = isSuccess 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    const content = isSuccess
        ? `<div class="py-6">
             <div class="text-sm text-zinc-400 mb-2">当前剩余电量</div>
             <div class="text-6xl font-mono font-bold tracking-tight text-white">${result.kwh} <span class="text-2xl text-zinc-500">kWh</span></div>
             <div class="mt-4 text-xs text-zinc-500 font-mono">已同步至数据库(KV)</div>
           </div>`
        : `<div class="bg-red-950/30 border border-red-900/50 rounded-lg p-4 text-left my-4">
             <div class="text-xs text-red-400 mb-1 font-semibold">ERROR DETAILS:</div>
             <code class="text-xs text-red-200 break-all font-mono">${result.error || 'Unknown Error'}</code>
           </div>`;

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Nakiri - ${title}</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:system-ui,-apple-system,sans-serif}</style></head><body class="bg-black text-zinc-100 min-h-screen flex items-center justify-center p-4"><div class="max-w-sm w-full bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-8 text-center animate-[fade-in_0.5s_ease-out]"><div class="w-20 h-20 ${colorClass} rounded-full flex items-center justify-center mx-auto mb-6">${icon}</div><h1 class="text-2xl font-bold text-white mb-2">${title}</h1>${content}<div class="pt-6 border-t border-zinc-800 mt-2"><a href="/" class="group inline-flex items-center justify-center w-full py-3 px-4 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all active:scale-95"><span>返回仪表盘</span><svg class="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></a></div></div></body></html>`;
}

// --- 事件监听 (EdgeOne 写法) ---

async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);

    // 1. GET /api/config
    if (url.pathname === '/api/config') {
        const roomId = env.ROOM_ID || 'Unset';
        const buildId = env.BUILD_ID;
        const partId = env.PART_ID;
        let displayName = `Room ${roomId}`;
        if (buildId && partId) {
            let campus = (partId === '0' || partId === '奉贤') ? "奉贤" : ((partId === '1' || partId === '徐汇') ? "徐汇" : partId);
            let buildDisplay = /^\d+$/.test(buildId) ? `${buildId}号楼` : buildId;
            displayName = `${campus}-${buildDisplay}-${roomId}`;
        }
        return new Response(JSON.stringify({ roomId, displayName, version: 'EdgeOne-KV-v1.0' }), { headers: { "Content-Type": "application/json" } });
    }

    // 2. GET /api/data
    if (url.pathname === '/api/data') {
        if (!env.ELECTRIC_KV) return new Response(JSON.stringify({ error: "KV binding missing" }), { status: 500 });
        
        const roomId = env.ROOM_ID;
        // 从 KV 读取所有历史数据
        let results = await getHistoryFromKV(env, roomId);
        
        // 前端通过 JS 进行 30 天过滤，这里也可以做一层简单的过滤减少传输量
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 32); // 多给一点冗余
        results = results.filter(item => new Date(item.timestamp) > cutoff);
        
        return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }

    // 3. GET /api/scrape
    if (url.pathname === '/api/scrape') {
        const result = await scrape(env);
        const accept = request.headers.get("Accept");
        if (accept && accept.includes("application/json")) {
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(renderHtml(result), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // 4. 静态资源托管交给 EdgeOne Pages 自动处理
    // 注意：EdgeOne Functions 通常只拦截 /api 或者是被配置的路由。
    // 如果此脚本作为“全站接管”脚本，需要处理静态资源回源。
    // 假设配置为 functions 目录模式，非 functions 请求会自动回源到静态资源，此处只需返回 404 或 fetch upstream
    return fetch(request);
}

// EdgeOne 导出语法
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scrape(env));
  },
};