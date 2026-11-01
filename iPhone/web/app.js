"use strict";

const state = {
    token: null,
    user: null,
    guilds: [],
    guild: null,
    channels: [],
    channel: null,
    messages: [],
    mode: "normal",
};

class ApiError extends Error {
    constructor(message, status, code, retryAfter) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

const $ = selector => document.querySelector(selector);

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function show(name) {
    for (const screen of document.querySelectorAll(".screen")) screen.hidden = true;
    const target = { login: "#loginScreen", guilds: "#guildScreen", channels: "#channelScreen", chat: "#chatScreen" }[name];
    $(target).hidden = false;
}

function setTitle(text) {
    $("#title").textContent = text;
}

function showError(node, message) {
    node.textContent = message;
    node.hidden = false;
}

function hide(node) {
    node.textContent = "";
    node.hidden = true;
}

function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
}

let toastTimer = null;
function toast(text) {
    const node = $("#toast");
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        node.hidden = true;
    }, 2200);
}

async function api(method, path, body) {
    const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: state.token, method, path, body }),
    });
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    if (!response.ok) {
        throw new ApiError(
            (data && data.message) || `HTTP ${response.status}`,
            response.status,
            data && data.code,
            data && data.retry_after,
        );
    }
    return data;
}

function describeError(error) {
    if (error instanceof ApiError) {
        if (error.status === 401) return "トークンが無効です (401)。Bot トークンを確認してください。";
        if (error.status === 403) return `アクセス拒否 (403): ${error.message}`;
        if (error.status === 404) return `見つかりません (404): ${error.message}`;
        if (error.status === 429) {
            const seconds = Math.ceil(Number(error.retryAfter) || 0);
            return `レート制限 (429): ${seconds} 秒後に再試行してください。`;
        }
        if (error.status === 502) return error.message;
        return `${error.status}: ${error.message}`;
    }
    if (error instanceof TypeError) return "ネットワークに接続できません。bridge が起動しているか確認してください。";
    return error && error.message ? error.message : String(error);
}

function initial(name) {
    const trimmed = (name || "?").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function avatarNode(name, url) {
    const box = el("div", "avatar");
    if (!url) {
        box.textContent = initial(name);
        return box;
    }
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    image.addEventListener("error", () => {
        box.textContent = initial(name);
    });
    box.appendChild(image);
    return box;
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function login() {
    const input = $("#tokenInput");
    const button = $("#loginBtn");
    const errorNode = $("#loginError");
    hide(errorNode);
    const token = input.value.trim();
    if (!token) {
        showError(errorNode, "Bot トークンを入力してください。");
        return;
    }
    state.token = token;
    setBusy(button, true, "ログイン中…");
    try {
        state.user = await api("GET", "/users/@me");
        input.value = "";
        $("#logoutBtn").hidden = false;
        $("#backBtn").hidden = true;
        setTitle(state.user.global_name || state.user.username || "BotClient");
        await loadGuilds();
        show("guilds");
        toast(`ログインしました: ${state.user.username}`);
    } catch (error) {
        state.token = null;
        state.user = null;
        showError(errorNode, describeError(error));
    } finally {
        setBusy(button, false, "ログイン");
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.guilds = [];
    state.guild = null;
    state.channels = [];
    state.channel = null;
    state.messages = [];
    $("#logoutBtn").hidden = true;
    $("#backBtn").hidden = true;
    $("#tokenInput").value = "";
    hide($("#loginError"));
    hide($("#sendError"));
    clearTimeout(toastTimer);
    $("#toast").hidden = true;
    setTitle("BotClient");
    show("login");
}

async function loadGuilds() {
    const guilds = await api("GET", "/users/@me/guilds");
    state.guilds = Array.isArray(guilds) ? guilds : [];
    renderGuilds();
}

function renderGuilds() {
    const list = $("#guildList");
    list.textContent = "";
    $("#guildEmpty").hidden = state.guilds.length > 0;
    for (const guild of state.guilds) {
        const item = el("li");
        item.dataset.id = guild.id;
        const iconUrl = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96` : null;
        item.appendChild(avatarNode(guild.name, iconUrl));
        const meta = el("div", "meta");
        meta.appendChild(el("div", "name", guild.name || guild.id));
        meta.appendChild(el("div", "desc", guild.owner ? "オーナー" : "サーバー"));
        item.appendChild(meta);
        item.appendChild(el("div", "chev", "›"));
        item.addEventListener("click", () => openGuild(guild));
        list.appendChild(item);
    }
}

async function openGuild(guild) {
    state.guild = guild;
    state.channel = null;
    setTitle(guild.name || "サーバー");
    $("#backBtn").hidden = false;
    show("channels");
    $("#channelList").textContent = "";
    try {
        const channels = await api("GET", `/guilds/${guild.id}/channels`);
        state.channels = (Array.isArray(channels) ? channels : [])
            .filter(channel => [0, 5, 15].includes(channel.type))
            .sort((a, b) => (a.position || 0) - (b.position || 0));
        renderChannels();
    } catch (error) {
        toast(describeError(error));
    }
}

function renderChannels() {
    const list = $("#channelList");
    list.textContent = "";
    $("#channelEmpty").hidden = state.channels.length > 0;
    for (const channel of state.channels) {
        const item = el("li");
        item.dataset.id = channel.id;
        const glyph = channel.type === 15 ? "◈" : "#";
        const avatar = el("div", "avatar", glyph);
        avatar.style.fontSize = "20px";
        item.appendChild(avatar);
        const meta = el("div", "meta");
        meta.appendChild(el("div", "name", channel.name || channel.id));
        const kind = channel.type === 5 ? "アナウンス" : channel.type === 15 ? "フォーラム" : "テキスト";
        meta.appendChild(el("div", "desc", channel.topic ? channel.topic.slice(0, 60) : kind));
        item.appendChild(meta);
        item.appendChild(el("div", "chev", "›"));
        item.addEventListener("click", () => openChannel(channel));
        list.appendChild(item);
    }
}

async function openChannel(channel) {
    state.channel = channel;
    setTitle(`# ${channel.name || channel.id}`);
    $("#backBtn").hidden = false;
    hide($("#sendError"));
    show("chat");
    $("#messages").textContent = "読み込み中…";
    try {
        await loadMessages();
    } catch (error) {
        $("#messages").textContent = "";
        showError($("#sendError"), describeError(error));
    }
}

async function loadMessages() {
    const messages = await api("GET", `/channels/${state.channel.id}/messages?limit=50`);
    state.messages = (Array.isArray(messages) ? messages : []).slice().reverse();
    renderMessages();
    const box = $("#messages");
    box.scrollTop = box.scrollHeight;
}

function renderMessages() {
    const box = $("#messages");
    box.textContent = "";
    if (!state.messages.length) {
        box.appendChild(el("p", "empty", "メッセージはまだありません。"));
        return;
    }
    for (const message of state.messages) box.appendChild(renderMessage(message));
}

function renderMessage(message) {
    const row = el("div", "msg");
    if (message.id) row.dataset.id = message.id;

    const head = el("div", "head");
    const author = message.author || {};
    head.appendChild(el("span", "author", author.global_name || author.username || "unknown"));
    if (author.bot) head.appendChild(el("span", "bot-tag", "BOT"));
    head.appendChild(el("span", "time", formatTime(message.timestamp)));
    row.appendChild(head);

    if (message.content) {
        row.appendChild(el("div", "body", message.content));
    } else if (!message.embeds?.length && !message.components?.length && !message.attachments?.length) {
        row.appendChild(el("div", "body system", "（システムメッセージ）"));
    }

    for (const embed of message.embeds || []) row.appendChild(renderEmbed(embed));
    if (message.components?.length) {
        const box = el("div", "cv2");
        walkComponents(message.components, box);
        if (box.childNodes.length) row.appendChild(box);
    }
    for (const attachment of message.attachments || []) {
        if ((attachment.content_type || "").startsWith("image/")) {
            const image = document.createElement("img");
            image.className = "embed-image";
            image.src = attachment.url;
            image.alt = attachment.filename || "";
            image.style.maxWidth = "100%";
            image.style.marginTop = "6px";
            image.style.borderRadius = "6px";
            row.appendChild(image);
        } else {
            const link = document.createElement("a");
            link.href = attachment.url;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = attachment.filename || "添付ファイル";
            link.style.display = "block";
            link.style.marginTop = "4px";
            link.style.color = "#00a8fc";
            row.appendChild(link);
        }
    }
    return row;
}

function renderEmbed(embed) {
    const box = el("div", "embed");
    if (typeof embed.color === "number") {
        box.style.borderLeftColor = `#${embed.color.toString(16).padStart(6, "0")}`;
    }
    if (embed.author?.name) {
        box.appendChild(el("div", "e-footer", embed.author.name));
    }
    if (embed.title) box.appendChild(el("div", "e-title", embed.title));
    if (embed.description) box.appendChild(el("div", "e-desc", embed.description));
    for (const field of embed.fields || []) {
        const entry = el("div", "e-field");
        entry.appendChild(el("b", null, field.name));
        entry.appendChild(document.createTextNode(field.value || ""));
        box.appendChild(entry);
    }
    if (embed.image?.url) {
        const image = document.createElement("img");
        image.src = embed.image.url;
        image.alt = "";
        box.appendChild(image);
    }
    if (embed.footer?.text) box.appendChild(el("div", "e-footer", embed.footer.text));
    return box;
}

function walkComponents(nodes, host) {
    for (const node of nodes || []) {
        if (!node || typeof node !== "object") continue;
        if (node.type === 10) {
            host.appendChild(el("div", "cv2-text", node.content || ""));
        } else if (node.type === 14) {
            host.appendChild(el("div", "cv2-sep"));
        } else if (Array.isArray(node.components)) {
            walkComponents(node.components, host);
        }
    }
}

function parseColor(value) {
    const raw = (value || "").trim();
    if (!raw) return undefined;
    const hex = raw.replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex, 16);
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        return parseInt(
            hex
                .split("")
                .map(char => char + char)
                .join(""),
            16,
        );
    }
    return undefined;
}

function buildPayload() {
    if (state.mode === "normal") {
        const content = $("#contentInput").value.trim();
        if (!content) throw new Error("メッセージ内容を入力してください。");
        return { content };
    }
    if (state.mode === "embed") {
        const title = $("#embedTitle").value.trim();
        const description = $("#embedDesc").value.trim();
        if (!title && !description) throw new Error("Embed のタイトルか説明を入力してください。");
        const embed = {};
        if (title) embed.title = title;
        if (description) embed.description = description;
        const color = parseColor($("#embedColor").value);
        if (color !== undefined) embed.color = color;
        return { embeds: [embed] };
    }
    const text = $("#cv2Text").value.trim();
    if (!text) throw new Error("Text Display の内容を入力してください。");
    return {
        flags: 32768,
        components: [{ type: 17, components: [{ type: 10, content: text }] }],
    };
}

function clearInputs() {
    $("#contentInput").value = "";
    $("#embedTitle").value = "";
    $("#embedDesc").value = "";
    $("#embedColor").value = "";
    $("#cv2Text").value = "";
}

async function send() {
    if (!state.channel) return;
    hide($("#sendError"));
    let payload;
    try {
        payload = buildPayload();
    } catch (error) {
        showError($("#sendError"), error.message);
        return;
    }
    const button = $("#sendBtn");
    setBusy(button, true, "送信中…");
    try {
        const message = await api("POST", `/channels/${state.channel.id}/messages`, payload);
        window.__bcLastSentId = message && message.id;
        clearInputs();
        await loadMessages();
        toast("送信しました");
    } catch (error) {
        showError($("#sendError"), describeError(error));
    } finally {
        setBusy(button, false, "送信");
    }
}

function goBack() {
    if (state.channel) {
        state.channel = null;
        state.messages = [];
        hide($("#sendError"));
        setTitle(state.guild ? state.guild.name : "BotClient");
        show("channels");
        return;
    }
    if (state.guild) {
        state.guild = null;
        state.channels = [];
        setTitle("BotClient");
        show("guilds");
        $("#backBtn").hidden = true;
    }
}

function setMode(mode) {
    state.mode = mode;
    for (const button of document.querySelectorAll(".mode")) {
        button.classList.toggle("active", button.dataset.mode === mode);
    }
    $("#normalPane").hidden = mode !== "normal";
    $("#embedPane").hidden = mode !== "embed";
    $("#cv2Pane").hidden = mode !== "cv2";
    hide($("#sendError"));
}

function wire() {
    $("#loginBtn").addEventListener("click", login);
    $("#tokenInput").addEventListener("keydown", event => {
        if (event.key === "Enter") login();
    });
    $("#logoutBtn").addEventListener("click", logout);
    $("#backBtn").addEventListener("click", goBack);
    $("#sendBtn").addEventListener("click", send);
    for (const button of document.querySelectorAll(".mode")) {
        button.addEventListener("click", () => setMode(button.dataset.mode));
    }
    setMode("normal");
}

wire();
