import { createServer } from "node:http";

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:,">
  <title>Chroma capture demo</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #eef2ff; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at top, #312e81 0, #0b1020 55%); }
    main { width: min(680px, calc(100vw - 48px)); padding: 40px; border: 1px solid #475569; border-radius: 24px; background: rgba(15, 23, 42, .94); box-shadow: 0 24px 80px #020617aa; }
    p { color: #cbd5e1; line-height: 1.6; }
    .steps { display: grid; gap: 12px; margin: 28px 0; }
    button, input { font: inherit; border-radius: 10px; border: 1px solid #64748b; padding: 12px 14px; }
    button { color: white; background: #4f46e5; cursor: pointer; text-align: left; }
    button:hover { background: #6366f1; }
    form { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
    input { color: #eef2ff; background: #111827; }
    #status { min-height: 24px; color: #fbbf24; }
    code { color: #a5b4fc; }
  </style>
</head>
<body>
  <main>
    <p><code>chroma demo</code></p>
    <h1>Make a small browser bug, then keep the evidence.</h1>
    <p>Try these actions in order. Return to the terminal and press Enter when you are done.</p>
    <div class="steps">
      <button id="request-failure" type="button">1. Request an endpoint that returns HTTP 503</button>
      <button id="console-error" type="button">2. Write a deliberate console error</button>
      <form id="note-form">
        <input id="note" aria-label="Demo note" placeholder="3. Type any disposable text" autocomplete="off">
        <button type="submit">Submit note</button>
      </form>
    </div>
    <p id="status" role="status">Waiting for a demo action.</p>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;

const SCRIPT = `const status = document.querySelector("#status");
document.querySelector("#request-failure").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/failure");
    if (!response.ok) throw new Error(\`HTTP \${response.status} \${response.statusText}\`);
  } catch (error) {
    console.error("demo: request failed", error);
    status.textContent = "Recorded an HTTP 503 and its console error.";
  }
});
document.querySelector("#console-error").addEventListener("click", () => {
  console.error("demo: deliberate console error");
  status.textContent = "Recorded a deliberate console error.";
});
document.querySelector("#note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  status.textContent = "Submitted the note. Chroma stores its length, not its value.";
});`;

export const DEMO_EVIDENCE_REQUIREMENT = Object.freeze({
  id: "demo-minimum-v1",
  description: "At least one recorded action, browser error, and failed or HTTP-error request.",
  minimums: Object.freeze({ actions: 1, errors: 1, failedNetwork: 1 }),
});

export function assessDemoEvidence(summary) {
  const observed = {
    actions: summary.actions,
    errors: summary.errors,
    failedNetwork: summary.failedNetwork,
  };
  const checks = Object.fromEntries(Object.entries(DEMO_EVIDENCE_REQUIREMENT.minimums).map(([name, minimum]) => [
    name,
    { minimum, observed: observed[name], met: observed[name] >= minimum },
  ]));
  return {
    ...DEMO_EVIDENCE_REQUIREMENT,
    status: Object.values(checks).every((check) => check.met) ? "met" : "not-met",
    observed,
    checks,
  };
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function startDemoServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/") return send(response, 200, "text/html; charset=utf-8", HTML);
    if (pathname === "/app.js") return send(response, 200, "text/javascript; charset=utf-8", SCRIPT);
    if (pathname === "/api/failure") return send(response, 503, "application/json; charset=utf-8", '{"error":"intentional demo failure"}\n');
    if (pathname === "/favicon.ico") return send(response, 204, "image/x-icon", "");
    return send(response, 404, "text/plain; charset=utf-8", "Not found\n");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => server.close((error) => error ? closeReject(error) : closeResolve())),
      });
    });
  });
}
