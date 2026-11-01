#!/usr/bin/env node
// BotClient iPhone bridge: serves the mobile web client and relays Discord API
// calls with the bot User-Agent that Discord requires (browser UAs get 40333).
// The bot token is only ever in memory; it is never logged or written to disk.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(ROOT, "..", "web");
const API_BASE = "https://discord.com/api/v10";
const BOT_UA = "DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v2.0.0)";
const PORT = Number(process.env.PORT || 8787);
const LAN = process.argv.includes("--lan");
const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
const MAX_BODY = 2 * 1024 * 1024;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
}

async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new Error("body too large");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function proxy(req, res) {
    let payload;
    try {
        payload = JSON.parse(await readBody(req));
    } catch {
        return sendJson(res, 400, { message: "リクエストが不正です" });
    }
    const token = typeof payload?.token === "string" ? payload.token.trim() : "";
    if (!token) return sendJson(res, 400, { message: "Bot トークンがありません" });
    const method = String(payload?.method || "GET").toUpperCase();
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) {
        return sendJson(res, 400, { message: "許可されていないメソッドです" });
    }
    const apiPath = typeof payload?.path === "string" ? payload.path : "";
    if (!apiPath.startsWith("/") || apiPath.includes("..")) {
        return sendJson(res, 400, { message: "API パスが不正です" });
    }

    const headers = { Authorization: `Bot ${token}`, "User-Agent": BOT_UA, Accept: "application/json" };
    let body;
    if (payload.body !== undefined && method !== "GET" && method !== "DELETE") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(payload.body);
    }

    let upstream;
    try {
        upstream = await fetch(API_BASE + apiPath, { method, headers, body });
    } catch (error) {
        return sendJson(res, 502, { message: "Discord に接続できません: " + error.message });
    }
    const text = await upstream.text();
    const outHeaders = { "Cache-Control": "no-store" };
    outHeaders["Content-Type"] = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const remaining = upstream.headers.get("x-ratelimit-remaining");
    if (remaining !== null) outHeaders["X-RateLimit-Remaining"] = remaining;
    res.writeHead(upstream.status, outHeaders);
    res.end(text);
}

function serveStatic(req, res) {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
        res.writeHead(400).end();
        return;
    }
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.resolve(WEB_ROOT, "." + pathname);
    if (!filePath.startsWith(WEB_ROOT + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
            return;
        }
        res.writeHead(200, {
            "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            "Cache-Control": "no-store",
        });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/proxy") return proxy(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    sendJson(res, 405, { message: "method not allowed" });
});

function lanAddresses() {
    const found = [];
    for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
        }
    }
    return found;
}

server.listen(PORT, HOST, () => {
    console.log("BotClient iPhone bridge");
    console.log(`  local: http://127.0.0.1:${PORT}`);
    if (LAN) {
        for (const ip of lanAddresses()) console.log(`  LAN:   http://${ip}:${PORT}`);
        console.log("  ※ LAN 公開中は同じネットワーク内からアクセスできます。トークンは保存されません。");
    } else {
        console.log("  iPhone から使うには: node bridge.mjs --lan");
    }
});
