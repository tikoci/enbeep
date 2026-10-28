/**
 * Serve the live decoder page.
 *
 * Usage:
 *   bun run serve          # HTTP on :3456 (works for localhost testing)
 *   bun run serve --tls    # HTTPS on :3456 (required for iPhone mic access over LAN)
 *   PORT=8080 bun run serve  # override port
 *
 * For --tls, generates a self-signed cert on first run.
 * Remote mic access requires a trusted secure context; self-signed
 * certificates may need device-specific trust setup. Prefer trusted HTTPS.
 */

import { appendFileSync, existsSync } from "node:fs";

const useTls = process.argv.includes("--tls");
const port = Number(process.env.PORT) || 3456;
const projectFile = (path: string) => Bun.file(new URL(path, import.meta.url));

// Serve the same shared-code WAV harness that Pages builds. Keep paths
// relative to this module so launching from another directory still works.
const harnessBundle = await Bun.build({
	entrypoints: [new URL("web/wav-entry.ts", import.meta.url).pathname],
	target: "browser",
});
if (!harnessBundle.success) {
	throw new AggregateError(harnessBundle.logs, "WAV harness build failed");
}

// Generate self-signed cert if needed
if (useTls) {
	const certFile = "cert.pem";
	const keyFile = "key.pem";

	if (!existsSync(certFile) || !existsSync(keyFile)) {
		console.log("Generating self-signed TLS certificate...");
		const proc = Bun.spawnSync([
			"openssl",
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-keyout",
			keyFile,
			"-out",
			certFile,
			"-days",
			"365",
			"-nodes",
			"-subj",
			"/CN=enbeep-local",
		]);
		if (proc.exitCode !== 0) {
			console.error("Failed to generate cert:", proc.stderr.toString());
			process.exit(1);
		}
		console.log("Created cert.pem and key.pem");
	}
}

Bun.serve({
	port,
	...(useTls && {
		tls: {
			cert: Bun.file("cert.pem"),
			key: Bun.file("key.pem"),
		},
	}),
	routes: {
		"/": new Response(projectFile("live.html"), {
			headers: { "Content-Type": "text/html" },
		}),
		"/index.html": new Response(projectFile("live.html"), {
			headers: { "Content-Type": "text/html" },
		}),
		"/live.html": new Response(projectFile("live.html"), {
			headers: { "Content-Type": "text/html" },
		}),
		"/harness.html": new Response(projectFile("harness.html"), {
			headers: { "Content-Type": "text/html" },
		}),
		"/wav-decode.js": new Response(harnessBundle.outputs[0], {
			headers: { "Content-Type": "application/javascript" },
		}),
		"/SPEC.md": new Response(projectFile("docs/SPEC.md")),
		"/enbeep-frame.rsc": new Response(projectFile("encode/enbeep-frame.rsc")),
		"/api/frame": {
			POST: async (req) => {
				const raw = await req.text();
				if (raw.length > 4096) {
					return Response.json({ ok: false, error: "body too large" }, { status: 413 });
				}
				let body: unknown;
				try {
					body = JSON.parse(raw);
				} catch {
					return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
				}
				if (typeof body !== "object" || body === null || (!("ok" in body) && !("alive" in body))) {
					return Response.json({ ok: false, error: "need {ok|alive, ...}" }, { status: 400 });
				}
				const row = JSON.stringify({
					ts: new Date().toISOString(),
					...(body as Record<string, unknown>),
				});
				try {
					appendFileSync("frames.jsonl", `${row}\n`);
				} catch (err) {
					return Response.json({ ok: false, error: String(err) }, { status: 500 });
				}
				return Response.json({ ok: true });
			},
		},
	},
	fetch() {
		return new Response("Not found", { status: 404 });
	},
});

// Get local IP for convenience
const proto = useTls ? "https" : "http";
console.log(`\nenbeep live decoder running at:`);
console.log(`  Local:   ${proto}://localhost:${port}`);

try {
	let ip = "";
	const tryGet = (args: string[]): string => {
		try {
			const p = Bun.spawnSync(args);
			if (p.exitCode === 0) return p.stdout.toString().trim().split(/\s+/)[0] ?? "";
		} catch {}
		return "";
	};
	ip = tryGet(["ipconfig", "getifaddr", "en0"]);
	if (!ip) ip = tryGet(["hostname", "-I"]);
	if (!ip) ip = tryGet(["hostname", "-i"]);
	if (ip) {
		console.log(`  Network: ${proto}://${ip}:${port}`);
		if (useTls) {
			console.log(`\n  Open the Network URL on your iPhone.`);
			console.log(`  Self-signed TLS: mic access may require device-specific certificate trust.`);
		} else {
			console.log(`\n  Note: iPhone mic requires HTTPS. Run with --tls for LAN access.`);
		}
	}
} catch {}

console.log();
