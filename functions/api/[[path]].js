/**
 * Nakiri Electricity Monitor - EdgeOne Pages Version
 * 文件路径建议: functions/api/[[path]].js
 */

// --- 1. 配置与常量 ---
const BASE_URL = "https://yktyd.ecust.edu.cn/epay/wxpage/wanxiao/eleresult";
const USER_AGENT = "Mozilla/5.0 (Linux; U; Android 4.1.2; zh-cn; Chitanda/Akari) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30 MicroMessenger/6.0.0.58_r884092.501 NetType/WIFI";
const REGEX = /(-?\d+(\.\d+)?)度/;

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

// --- 2. 核心逻辑函数 ---

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

async function getHistoryFromKV(env, roomId) {
    try {
        // 【注意】这里必须确保 env.ELECTRIC_KV 存在，否则会报错
        if (!env.ELECTRIC_KV) return [];
        const raw = await env.ELECTRIC_KV.get(`history_${roomId}`);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error("KV Read Error:", e);
        return [];
    }
}

async function saveHistoryToKV(env, roomId, newDataPoint) {
    try {
        if (!env.ELECTRIC_KV) return;
        let history = await getHistoryFromKV(env, roomId);
        const exists = history.some(h => h.timestamp === newDataPoint.timestamp);
        if (!exists) {
            history.push(newDataPoint);
            // 保留最近 1000 条
            if (history.length > 1000) history = history.slice(-1000);
            await env.ELECTRIC_KV.put(`history_${roomId}`, JSON.stringify(history));
        }
    } catch (e) {
        console.error("KV Write Error:", e);
    }
}

async function scrape(env) {
    const roomId = env.ROOM_ID;
    if (!roomId) return { error: "ROOM_ID not set (Check Environment Variables)" };
    if (!env.ELECTRIC_KV) return { error: "KV Binding 'ELECTRIC_KV' missing" };

    let url = env.ROOM_URL || autoGenerateUrl(env);
    if (!url) url = `${BASE_URL}?sysid=1&areaid=3&buildid=20&roomid=${roomId}`;

    try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) return { error: `Remote Server Error: HTTP ${response.status}` };
        const text = await response.text();
        const match = text.match(REGEX);
        
        if (match && match[1]) {
            const kwh = parseFloat(match[1]);
            const timestamp = new Date().toISOString();
            await saveHistoryToKV(env, roomId, { timestamp, room_id: roomId, kWh: kwh });
            return { success: true, kwh };
        }
        return { error: "Parse failed: Could not find electricity data in page" };
    } catch (e) {
        return { error: e.message };
    }
}

function renderHtml(result) {
    const isSuccess = result.success;
    const title = isSuccess ? "更新成功" : "更新失败";
    const colorClass = isSuccess ? "text-green-500 bg-green-500/10" : "text-red-500 bg-red-500/10";
    const icon = isSuccess 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    const content = isSuccess
        ? `<div class="py-6"><div class="text-sm text-zinc-400 mb-2">当前剩余电量</div><div class="text-6xl font-mono font-bold tracking-tight text-white">${result.kwh} <span class="text-2xl text-zinc-500">kWh</span></div><div class="mt-4 text-xs text-zinc-500 font-mono">已同步至数据库(KV)</div></div>`
        : `<div class="bg-red-950/30 border border-red-900/50 rounded-lg p-4 text-left my-4"><div class="text-xs text-red-400 mb-1 font-semibold">ERROR DETAILS:</div><code class="text-xs text-red-200 break-all font-mono">${result.error || 'Unknown Error'}</code></div>`;

    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-black text-zinc-100 min-h-screen flex items-center justify-center p-4"><div class="max-w-sm w-full bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-8 text-center"><div class="w-20 h-20 ${colorClass} rounded-full flex items-center justify-center mx-auto mb-6">${icon}</div><h1 class="text-2xl font-bold text-white mb-2">${title}</h1>${content}<div class="pt-6 border-t border-zinc-800 mt-2"><a href="/" class="group inline-flex items-center justify-center w-full py-3 px-4 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all active:scale-95">返回仪表盘</a></div></div></body></html>`;
}

// --- 3. 业务逻辑路由器 (Common Logic) ---
async function handleRequest(request, env) {
    const url = new URL(request.url);
    
    // 调试模式：如果 env 没传进来，这里会报错
    if (!env) return new Response("Fatal: Environment Variables missing in Handler", { status: 500 });

    // 路由 1: /api/config
    if (url.pathname.endsWith('/config')) {
        const roomId = env.ROOM_ID || 'Unset';
        const buildId = env.BUILD_ID;
        const partId = env.PART_ID;
        let displayName = `Room ${roomId}`;
        if (buildId && partId) {
            let campus = (partId === '0' || partId === '奉贤') ? "奉贤" : ((partId === '1' || partId === '徐汇') ? "徐汇" : partId);
            let buildDisplay = /^\d+$/.test(buildId) ? `${buildId}号楼` : buildId;
            displayName = `${campus}-${buildDisplay}-${roomId}`;
        }
        return new Response(JSON.stringify({ roomId, displayName, version: 'EdgeOne-Pages-v2' }), { headers: { "Content-Type": "application/json" } });
    }

    // 路由 2: /api/data
    if (url.pathname.endsWith('/data')) {
        const roomId = env.ROOM_ID;
        let results = await getHistoryFromKV(env, roomId);
        
        // 简单过滤最近32天
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 32); 
        results = results.filter(item => new Date(item.timestamp) > cutoff);
        
        return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }

    // 路由 3: /api/scrape
    if (url.pathname.endsWith('/scrape')) {
        const result = await scrape(env);
        const accept = request.headers.get("Accept");
        if (accept && accept.includes("application/json")) {
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(renderHtml(result), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
}

// --- 4. 适配器：Pages Functions 入口 ---
// 这就是你刚才发的示例中的写法，我们在这里调用上面的逻辑
export async function onRequest({ request, env }) {
    return handleRequest(request, env);
}