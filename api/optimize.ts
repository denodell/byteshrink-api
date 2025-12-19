import Groq from "groq-sdk";

export const config = {
	runtime: "edge",
};

const allowedOrigins = [
	"https://byteshrink.dev",
	"https://www.byteshrink.dev",
	"http://localhost:3000", // for local dev
];

export async function OPTIONS(request: Request) {
	const origin = request.headers.get("origin") || "";
	const headers = {
		"Access-Control-Allow-Origin": allowedOrigins.includes(origin)
			? origin
			: "",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "X-Model, Content-Type",
	};

	return new Response(null, {
		status: 204,
		headers,
	});
}

export async function POST(request: Request) {
	const origin = request.headers.get("origin") || "";
	const corsHeaders = {
		"Access-Control-Allow-Origin": allowedOrigins.includes(origin)
			? origin
			: "",
		"Access-Control-Allow-Headers": "X-Model, Content-Type",
	};

	try {
		const body = await request.json();
		const { dependencies, devDependencies } = body;

		if (!dependencies && !devDependencies) {
			return new Response(
				JSON.stringify({ error: "Missing dependencies in request body" }),
				{
					status: 400,
					headers: { ...corsHeaders, "Content-Type": "application/json" },
				},
			);
		}

		const prompt = buildPrompt(dependencies, devDependencies);

		// Groq with streaming
		console.log("Sending prompt to Groq:", prompt);
		const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

		const stream = await groq.chat.completions.create({
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
			temperature: 0.3,
			model: "openai/gpt-oss-20b",
			stream: true,
		});

		// Create a ReadableStream to pipe the Groq stream to the client
		const encoder = new TextEncoder();
		const readableStream = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of stream) {
						const content = chunk.choices[0]?.delta?.content || "";
						if (content) {
							controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
						}
					}
					controller.enqueue(encoder.encode("data: [DONE]\n\n"));
					controller.close();
				} catch (error) {
					console.error("Stream error:", error);
					controller.error(error);
				}
			},
		});

		return new Response(readableStream, {
			status: 200,
			headers: {
				...corsHeaders,
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	} catch (err) {
		console.error("💥 Error in API handler:", err);
		return new Response(JSON.stringify({ error: "Internal error" }), {
			status: 500,
			headers: { ...corsHeaders, "Content-Type": "application/json" },
		});
	}
}

function buildPrompt(
	deps: Record<string, string>,
	devDeps: Record<string, string>,
): string {
	const depList = JSON.stringify(deps ?? {}, null, 2);
	const devDepList = JSON.stringify(devDeps ?? {}, null, 2);

	return `
You are a JavaScript optimization expert. Analyze this package.json and return bundle size and performance suggestions.

Dependencies:
\`\`\`json
${depList}
\`\`\`

DevDependencies:
\`\`\`json
${devDepList}
\`\`\`

Suggest:
- unnecessary packages
- heavy packages with lighter alternatives
- outdated packages with better performance in newer versions
- anything else that will reduce JS bundle size or install footprint

Reply in clear markdown. Avoid code unless necessary.
`;
}
