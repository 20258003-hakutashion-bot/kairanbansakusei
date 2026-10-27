// アップロード済みのファイルを、LINEの友だち全員に1通(カルーセル)で配信する
import { getStore } from "@netlify/blobs";

const ID = /^[0-9a-f]{32}\.(pdf|jpg|doc|docx)$/;
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function bubble(title, label, url, previewUrl, pos) {
  const body = [
    { type: "text", text: "回覧板が届きました", weight: "bold", size: "lg", color: "#1F6F4A" },
    { type: "text", text: title, wrap: true, size: "xl", weight: "bold" },
  ];
  if (pos) body.push({ type: "text", text: pos, size: "md", color: "#555555" });
  const b = {
    type: "bubble", size: "mega",
    body: { type: "box", layout: "vertical", spacing: "md", contents: body },
    footer: { type: "box", layout: "vertical", contents: [
      { type: "button", style: "primary", color: "#1F6F4A", height: "md",
        action: { type: "uri", label: `${label}を開く`, uri: url } }] },
  };
  if (previewUrl) b.hero = { type: "image", url: previewUrl, size: "full", aspectRatio: "4:3", aspectMode: "fit",
                              action: { type: "uri", uri: url } };
  return b;
}

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, message: "POSTで送ってください。" }, 405);
  const token = process.env.LINE_TOKEN;
  if (!token) return json({ ok: false, message: "LINE_TOKEN が設定されていません。" }, 500);

  let input;
  try { input = await req.json(); } catch { return json({ ok: false, message: "送信内容が正しくありません。" }, 400); }
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length || items.length > 10) return json({ ok: false, message: "送るものは1〜10個にしてください。" }, 400);

  const store = getStore("kairanban");
  const origin = new URL(req.url).origin;
  const title = String(input.title || "").trim().slice(0, 100);
  const missing = () => json({ ok: false, message: "ファイルが見つかりません。もう一度やり直してください。" }, 400);
  const bubbles = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!ID.test(it.id || "") || !(await store.getMetadata(it.id))) return missing();
    const ext = it.id.split(".")[1];
    let preview = null;
    if (it.previewId) {
      if (!ID.test(it.previewId) || !it.previewId.endsWith(".jpg") || !(await store.getMetadata(it.previewId))) return missing();
      preview = `${origin}/files/${it.previewId}`;
    }
    const label = ext === "jpg" ? "写真" : ext === "pdf" ? "PDF" : "Word";
    const shown = title || String(it.name || "回覧板").slice(0, 100);
    bubbles.push(bubble(shown, label, `${origin}/files/${it.id}`, preview,
                        items.length > 1 ? `${i + 1} / ${items.length}` : null));
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
};

export const config = { path: "/api/broadcast" };
