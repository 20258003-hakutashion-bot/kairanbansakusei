// 保存したファイルを配る(LINEのボタンから開かれるURL)
import { getStore } from "@netlify/blobs";

const TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export default async (req, context) => {
  const id = context.params.id;
  const m = /^[0-9a-f]{32}\.(pdf|jpg|doc|docx)$/.exec(id || "");
  if (!m) return new Response("Not found", { status: 404 });
  const data = await getStore("kairanban").get(id, { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  const headers = {
    "content-type": TYPES[m[1]],
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (m[1] === "doc" || m[1] === "docx") headers["content-disposition"] = 'attachment; filename="kairanban.' + m[1] + '"';
  return new Response(data, { headers });
};

export const config = { path: "/files/:id" };
