/**
 * Serve the live decoder page.
 *
 * Usage:
 *   bun run serve          # HTTP on :3456 (works for localhost testing)
 *   bun run serve --tls    # HTTPS on :3456 (required for iPhone mic access over LAN)
 *   PORT=8080 bun run serve  # override port
 *
 * For --tls, generates a self-signed cert on first run.
 * On iPhone, open https://<your-lan-ip>:3456 and accept the cert warning.
 */

import { existsSync } from "node:fs";

const useTls = process.argv.includes("--tls");
const port = Number(process.env.PORT) || 3456;

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
		"/": new Response(Bun.file("live.html"), {
			headers: { "Content-Type": "text/html" },
		}),
		"/live.html": new Response(Bun.file("live.html"), {
			headers: { "Content-Type": "text/html" },
		}),
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
			console.log(`  Safari will warn about the self-signed cert — tap "Show Details" → "visit this website".`);
		} else {
			console.log(`\n  Note: iPhone mic requires HTTPS. Run with --tls for LAN access.`);
		}
	}
} catch {}

console.log();
