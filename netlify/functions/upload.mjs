// 1ファイルずつ受け取って保存する(PDF / JPEG写真 / Word)
import { getStore } from "@netlify/blobs";

const MAX = 4 * 1024 * 1024; // Netlifyの受信上限(約6MB)に収まるよう4MBまで

function detect(b) {
  const s = (...a) => a.every((v, i) => b[i] === v);
  if (s(0x25, 0x50, 0x44, 0x46)) return "pdf";            // %PDF
  if (s(0xff, 0xd8, 0xff)) return "jpg";                  // JPEG
  if (s(0xd0, 0xcf, 0x11, 0xe0)) return "doc";            // 旧Word
  if (s(0x50, 0x4b, 0x03, 0x04)) return "docx";           // docx(zip)
  return null;
}

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, message: "POSTで送ってください。" }, 405);
  const data = await req.arrayBuffer();
  if (!data.byteLength) return json({ ok: false, message: "空のファイルです。" }, 400);
  if (data.byteLength > MAX) return json({ ok: false, message: "ファイルが大きすぎます(1つ4MBまで)。" }, 413);
  const ext = detect(new Uint8Array(data.slice(0, 8)));
  if (!ext) return json({ ok: false, message: "このファイルは送れません。PDF・写真・Wordを選んでください。" }, 400);

  const id = crypto.randomUUID().replaceAll("-", "") + "." + ext;
  await getStore("kairanban").set(id, data);
  return json({ ok: true, id });
};

export const config = { path: "/api/upload" };
