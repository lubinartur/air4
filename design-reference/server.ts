import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import multer from "multer";
import nodeFetch from "node-fetch";
import FormData from "form-data";

dotenv.config();

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(
  /\/$/,
  ""
);
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
const PORT = Number(process.env.PORT) || 3000;

const upload = multer({ storage: multer.memoryStorage() });

function backendUrl(path: string, query: express.Request["query"]): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
    } else {
      qs.append(key, String(value));
    }
  }
  const q = qs.toString();
  return `${BACKEND_URL}${path}${q ? `?${q}` : ""}`;
}

async function proxyJson(
  res: express.Response,
  url: string,
  init?: RequestInit
): Promise<void> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text || response.statusText };
  }
  res.status(response.status).json(data);
}

/** API proxies — must register before Vite middleware (otherwise SPA HTML is returned). */
function registerApiRoutes(): void {
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
      const response = await fetch(`${BACKEND_URL}/api/summary`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/transactions", async (req, res) => {
    try {
      const url = new URL(`${BACKEND_URL}/api/transactions`);
      if (req.query.limit) url.searchParams.set("limit", String(req.query.limit));
      if (req.query.skip) url.searchParams.set("skip", String(req.query.skip));
      const response = await fetch(url.toString());
      const data = await response.json();
      res.status(response.status).json(data);
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

  app.post("/api/chat", async (req, res) => {
    const { message, chatHistory, history, currentPage, current_page } =
      req.body ?? {};

    try {
      const response = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message,
          history: history ?? chatHistory ?? [],
          current_page: current_page ?? currentPage ?? null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.json({
        ...data,
        content: data.response ?? data.content ?? "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(500).json({ error: message });
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
        body: JSON.stringify(req.body ?? {}),
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
          body: JSON.stringify(req.body ?? {}),
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
          body: JSON.stringify(req.body ?? {}),
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
          body: JSON.stringify(req.body ?? {}),
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
          body: JSON.stringify(req.body ?? {}),
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
          body: JSON.stringify(req.body ?? {}),
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
        body: JSON.stringify(req.body ?? {}),
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
        body: JSON.stringify(req.body ?? {}),
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

  app.get("/api/finance/obligations", async (req, res) => {
    try {
      await proxyJson(res, backendUrl("/api/finance/obligations", req.query));
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
        body: JSON.stringify(req.body ?? {}),
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
        body: JSON.stringify(req.body ?? {}),
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

      const formData = new FormData();
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const response = await nodeFetch(`${BACKEND_URL}/api/upload`, {
        method: "POST",
        body: formData,
        headers: formData.getHeaders(),
      });

      const text = await response.text();
      let data: unknown;
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Design reference: http://localhost:${PORT}`);
    console.log(`API proxy → ${BACKEND_URL}`);
  });
}

startServer();
