/**
 * Shopping Preferences MCP Server
 * Vercel Serverless Function with SSE support for Claude.ai
 */

const SUPABASE_URL = "https://rdiakmwbvyqrmyewrrzp.supabase.co/rest/v1";
const SUPABASE_KEY = "sb_publishable_VlHxx4Ec1P3fdojSlkcs4g_hz-pL_yc";

const SUPABASE_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// ── Supabase helper ───────────────────────────────────────────────────────────

async function query(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/${table}?${params}`, { headers: SUPABASE_HEADERS });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_color_profile",
    description: "Returns the user's personal color season profile (Soft Autumn), including undertones, contrast level, and eye/hair details. Use before recommending any clothing colors.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_color_palette",
    description: "Returns the user's best colors by category: neutrals, blues/greens, earth tones, accent colors, and colors to avoid. Always use this before recommending clothing.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category: neutrals, blues_greens, earth_tones, accent, avoid. Omit to get all.",
          enum: ["neutrals", "blues_greens", "earth_tones", "accent", "avoid"],
        },
      },
      required: [],
    },
  },
  {
    name: "get_metal_preferences",
    description: "Returns the user's preferred metals and accessories. Gold, Bronze, Copper, Tortoise Shell are best; Silver and Chrome are avoid.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_style_tips",
    description: "Returns personal style tips for the user's Soft Autumn coloring — fabric choices, contrast guidance, print scale, and what to avoid near the face.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_buying_preferences",
    description: "Returns the user's shopping habits and brand preferences. Always check Costco first. Prefers buying direct from brand. Has Amazon Prime. Apple for electronics. Nike/Adidas for shoes. Loves soccer and golf.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Filter by category: general, electronics, shoes, sports. Omit to get all.",
          enum: ["general", "electronics", "shoes", "sports"],
        },
      },
      required: [],
    },
  },
  {
    name: "get_all_preferences",
    description: "Returns ALL user preferences in one call — color profile, palette, metals, style tips, and buying habits. Use this at the start of any shopping session.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────────

async function runTool(name, args) {
  switch (name) {
    case "get_color_profile":
      return (await query("color_profile", "select=*&limit=1"))[0] ?? {};

    case "get_color_palette":
      return await query(
        "color_palette",
        args.category
          ? `select=*&category=eq.${args.category}&order=id`
          : "select=*&order=category,id"
      );

    case "get_metal_preferences":
      return await query("metal_preferences", "select=*&order=preference_level,id");

    case "get_style_tips":
      return await query("style_tips", "select=tip&order=id");

    case "get_buying_preferences":
      return await query(
        "buying_preferences",
        args.category
          ? `select=*&category=eq.${args.category}&order=id`
          : "select=*&order=category,id"
      );

    case "get_all_preferences": {
      const [profile, palette, metals, tips, buying] = await Promise.all([
        query("color_profile", "select=*&limit=1"),
        query("color_palette", "select=*&order=category,id"),
        query("metal_preferences", "select=*&order=preference_level,id"),
        query("style_tips", "select=tip&order=id"),
        query("buying_preferences", "select=*&order=category,id"),
      ]);
      return {
        color_profile: profile[0] ?? {},
        color_palette: palette,
        metal_preferences: metals,
        style_tips: tips,
        buying_preferences: buying,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP message handler ───────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "shopping-preferences", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;
    try {
      const result = await runTool(name, args);
      return {
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  if (id !== undefined) {
    return {
      jsonrpc: "2.0", id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  return null;
}

// ── Vercel handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // SSE endpoint — Claude.ai connects here to establish the MCP session
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const host = req.headers.host;
    const protocol = host.includes("localhost") ? "http" : "https";
    const postUrl = `${protocol}://${host}/api/mcp`;

    res.write(`event: endpoint\ndata: ${postUrl}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    req.on("close", () => clearInterval(keepAlive));
    return;
  }

  // POST — handle incoming MCP messages
  if (req.method === "POST") {
    try {
      const body = req.body;
      const messages = Array.isArray(body) ? body : [body];
      const responses = [];

      for (const msg of messages) {
        const response = await handleMessage(msg);
        if (response) responses.push(response);
      }

      if (responses.length === 0) return res.status(204).end();
      if (responses.length === 1) return res.status(200).json(responses[0]);
      return res.status(200).json(responses);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
