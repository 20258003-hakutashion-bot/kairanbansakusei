// Cloudflare Workers 版:回覧板をLINEの友だち全員に送る
// 画面(public/index.html)は Workers の静的アセットとして自動配信されます。
// ファイルの保存先は R2(バインディング名: BUCKET)です。

const MAX = 4 * 1024 * 1024; // 1ファイル4MBまで
const ID = /^[0-9a-f]{32}\.(pdf|jpg|doc|docx)$/;
const TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function detect(b) {
  const s = (...a) => a.every((v, i) => b[i] === v);
  if (s(0x25, 0x50, 0x44, 0x46)) return "pdf"; // %PDF
  if (s(0xff, 0xd8, 0xff)) return "jpg"; // JPEG
  if (s(0xd0, 0xcf, 0x11, 0xe0)) return "doc"; // 旧Word
  if (s(0x50, 0x4b, 0x03, 0x04)) return "docx"; // docx(zip)
  return null;
}

// ---- /api/upload : 1ファイルずつ受け取って保存 ----
async function upload(req, env) {
  if (req.method !== "POST") return json({ ok: false, message: "POSTで送ってください。" }, 405);
  const data = await req.arrayBuffer();
  if (!data.byteLength) return json({ ok: false, message: "空のファイルです。" }, 400);
  if (data.byteLength > MAX) return json({ ok: false, message: "ファイルが大きすぎます(1つ4MBまで)。" }, 413);
  const ext = detect(new Uint8Array(data.slice(0, 8)));
  if (!ext) return json({ ok: false, message: "このファイルは送れません。PDF・写真・Wordを選んでください。" }, 400);

  const id = crypto.randomUUID().replaceAll("-", "") + "." + ext;
  await env.BUCKET.put(id, data, { httpMetadata: { contentType: TYPES[ext] } });
  return json({ ok: true, id });
}

// ---- /files/:id : 保存したファイルを配る(LINEのボタンから開かれるURL) ----
async function files(id, env) {
  const m = ID.exec(id || "");
  if (!m) return new Response("Not found", { status: 404 });
  const obj = await env.BUCKET.get(id);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = {
    "content-type": TYPES[m[1]],
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (m[1] === "doc" || m[1] === "docx") {
    headers["content-disposition"] = 'attachment; filename="kairanban.' + m[1] + '"';
  }
  return new Response(obj.body, { headers });
}

// ---- LINEのカード(Flex Message)を作る ----
function bubble(title, label, url, previewUrl, pos) {
  const body = [
    { type: "text", text: "回覧板が届きました", weight: "bold", size: "lg", color: "#1F6F4A" },
    { type: "text", text: title, wrap: true, size: "xl", weight: "bold" },
  ];
  if (pos) body.push({ type: "text", text: pos, size: "md", color: "#555555" });
  const b = {
    type: "bubble",
    size: "mega",
    body: { type: "box", layout: "vertical", spacing: "md", contents: body },
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#1F6F4A",
          height: "md",
          action: { type: "uri", label: `${label}を開く`, uri: url },
        },
      ],
    },
  };
  if (previewUrl) {
    b.hero = {
      type: "image",
      url: previewUrl,
      size: "full",
      aspectRatio: "4:3",
      aspectMode: "fit",
      action: { type: "uri", uri: url },
    };
  }
  return b;
}

// ---- /api/broadcast : LINEの友だち全員に1通(カルーセル)で配信 ----
async function broadcast(req, env) {
  if (req.method !== "POST") return json({ ok: false, message: "POSTで送ってください。" }, 405);
  const token = env.LINE_TOKEN;
  if (!token) return json({ ok: false, message: "LINE_TOKEN が設定されていません。" }, 500);

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, message: "送信内容が正しくありません。" }, 400);
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length || items.length > 10) {
    return json({ ok: false, message: "送るものは1〜10個にしてください。" }, 400);
  }

  const origin = new URL(req.url).origin;
  const title = String(input.title || "").trim().slice(0, 100);
  const missing = () => json({ ok: false, message: "ファイルが見つかりません。もう一度やり直してください。" }, 400);
  const exists = async (id) => !!(await env.BUCKET.head(id));

  const bubbles = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!ID.test(it.id || "") || !(await exists(it.id))) return missing();
    const ext = it.id.split(".")[1];
    let preview = null;
    if (it.previewId) {
      if (!ID.test(it.previewId) || !it.previewId.endsWith(".jpg") || !(await exists(it.previewId))) return missing();
      preview = `${origin}/files/${it.previewId}`;
    }
    const label = ext === "jpg" ? "写真" : ext === "pdf" ? "PDF" : "Word";
    const shown = title || String(it.name || "回覧板").slice(0, 100);
    bubbles.push(
      bubble(shown, label, `${origin}/files/${it.id}`, preview, items.length > 1 ? `${i + 1} / ${items.length}` : null)
    );
  }

  const contents = bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles };
  const alt = ("回覧板: " + (title || items[0].name || "")).slice(0, 400);
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ type: "flex", altText: alt, contents }] }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.error("LINE error", res.status, detail);
    return json({ ok: false, message: `LINEへの送信に失敗しました。管理者にお知らせください。(${res.status}) ${detail}` }, 502);
  }
  return json({ ok: true, message: "友だち全員に送りました。" });
}

export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    if (p === "/api/upload") return upload(req, env);
    if (p === "/api/broadcast") return broadcast(req, env);
    const m = /^\/files\/([^/]+)$/.exec(p);
    if (m) return files(m[1], env);
    return new Response("Not found", { status: 404 });
  },
};
