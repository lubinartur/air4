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
app.use(import_express.default.json({ limit: "10mb" }));
app.use(import_express.default.urlencoded({ limit: "10mb", extended: true }));
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
function registerApiRoutes() {
  app.get("/api/uploads", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/uploads`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/summary", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/summary", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/transactions", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/transactions", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.put("/api/transactions/:transactionId/category", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/transactions/${encodeURIComponent(req.params.transactionId)}/category`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/insights", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/insights`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/chat/history", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/chat/history", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/feed", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/feed", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/chat", async (req, res) => {
    const wantsStream = String(req.headers.accept ?? "").includes(
      "text/event-stream"
    );
    try {
      const upstream = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: wantsStream ? "text/event-stream" : "application/json"
        },
        body: JSON.stringify(req.body ?? {})
      });
      if (!upstream.ok) {
        const errText = await upstream.text();
        try {
          return res.status(upstream.status).json(JSON.parse(errText));
        } catch {
          return res.status(upstream.status).send(errText);
        }
      }
      if (wantsStream && upstream.body) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength > 0) {
              res.write(Buffer.from(value));
            }
          }
        } finally {
          res.end();
        }
        return;
      }
      const data = await upstream.json();
      res.json({
        ...data,
        content: data.response ?? data.content ?? ""
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.end();
      }
    }
  });
  app.get("/api/projects", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/projects", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/projects", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/projects/:projectId", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/projects/:projectId/logs", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}/logs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/projects/:projectId/sessions/start", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}/sessions/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/projects/:projectId/sessions/stop", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}/sessions/stop`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/projects/:projectId/todos", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}/todos`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/projects/:projectId/todos", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/${encodeURIComponent(req.params.projectId)}/todos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.put("/api/projects/todos/:todoId", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/projects/todos/${encodeURIComponent(req.params.todoId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/dilemmas", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/dilemmas", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/observations", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/observations", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/health/workouts", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/health/workouts", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/health/workouts", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/health/workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/health/metrics", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/health/metrics", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/health/metrics", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/health/metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/health/checkups", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/health/checkups", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/profile", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/profile", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/events", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/events", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/goals", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/goals", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/hypotheses", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/hypotheses", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/finance/subscriptions", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/finance/subscriptions", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/finance/subscriptions", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/finance/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.put("/api/finance/subscriptions/:id", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/finance/subscriptions/${encodeURIComponent(req.params.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.delete("/api/finance/subscriptions/:id", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/finance/subscriptions/${encodeURIComponent(req.params.id)}`,
        { method: "DELETE" }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/finance/obligations", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/finance/obligations", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/finance/obligations", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/finance/obligations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.put("/api/finance/obligations/:id", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/finance/obligations/${encodeURIComponent(req.params.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body ?? {})
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.delete("/api/finance/obligations/:id", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/finance/obligations/${encodeURIComponent(req.params.id)}`,
        { method: "DELETE" }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/finance/monthly-fixed", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/finance/monthly-fixed", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/finance/cycles", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/finance/cycles", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.get("/api/interview/question", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/interview/question", req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.put("/api/interview/answer", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/interview/answer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.post("/api/observations/generate", async (req, res) => {
    try {
      await proxyJson(res, `${BACKEND_URL}/api/observations/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });
  app.delete("/api/uploads/:uploadId", async (req, res) => {
    try {
      await proxyJson(
        res,
        `${BACKEND_URL}/api/uploads/${encodeURIComponent(req.params.uploadId)}`,
        { method: "DELETE" }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
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
}
async function startServer() {
  registerApiRoutes();
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
