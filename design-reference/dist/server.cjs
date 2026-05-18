var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_multer = __toESM(require("multer"), 1);
var import_node_fetch = __toESM(require("node-fetch"), 1);
var import_form_data = __toESM(require("form-data"), 1);
import_dotenv.default.config();
var BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(
  /\/$/,
  ""
);
var app = (0, import_express.default)();
app.use(import_express.default.json());
var PORT = Number(process.env.PORT) || 3e3;
var upload = (0, import_multer.default)({ storage: import_multer.default.memoryStorage() });
function backendUrl(path2, query) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
    } else {
      qs.append(key, String(value));
    }
  }
  const q = qs.toString();
  return `${BACKEND_URL}${path2}${q ? `?${q}` : ""}`;
}
async function proxyJson(res, url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text || response.statusText };
  }
  res.status(response.status).json(data);
}
app.post("/api/chat", async (req, res) => {
  const { message, chatHistory, history, currentPage, current_page } = req.body ?? {};
  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      message,
      history: history ?? chatHistory ?? [],
      current_page: current_page ?? currentPage ?? null
    })
  });
  const data = await response.json();
  if (!response.ok) {
    return res.status(response.status).json(data);
  }
  res.json({
    ...data,
    content: data.response ?? data.content ?? ""
  });
});
app.get("/api/summary", async (req, res) => {
  await proxyJson(res, backendUrl("/api/summary", req.query));
});
app.get("/api/insights", async (req, res) => {
  await proxyJson(res, backendUrl("/api/insights", req.query));
});
app.get("/api/transactions", async (req, res) => {
  await proxyJson(res, backendUrl("/api/transactions", req.query));
});
app.get("/api/projects", async (req, res) => {
  await proxyJson(res, backendUrl("/api/projects", req.query));
});
app.get("/api/dilemmas", async (req, res) => {
  await proxyJson(res, backendUrl("/api/dilemmas", req.query));
});
app.get("/api/observations", async (req, res) => {
  await proxyJson(res, backendUrl("/api/observations", req.query));
});
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: "No file uploaded" });
    }
    const formData = new import_form_data.default();
    formData.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    const response = await (0, import_node_fetch.default)(`${BACKEND_URL}/api/upload`, {
      method: "POST",
      body: formData,
      headers: formData.getHeaders()
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text || response.statusText };
    }
    res.status(response.status).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload proxy failed";
    res.status(500).json({ detail: message });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Design reference: http://localhost:${PORT}`);
    console.log(`API proxy \u2192 ${BACKEND_URL}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
