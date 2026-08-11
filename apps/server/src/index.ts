import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const app = new Hono<{ Variables: { wsUserId: string } }>();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables for WebSocket auth");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorizationHeader.slice(7).trim() || null;
};

let messages = {};

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get(
  "/ws",
  async (c, next) => {
    const bearerToken = getBearerToken(c.req.header("authorization"));
    const queryToken = c.req.query("access_token");
    const accessToken = bearerToken ?? queryToken ?? null;

    if (!accessToken) {
      return c.text("Unauthorized: missing access token", 401);
    }

    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !user) {
      return c.text("Unauthorized: invalid access token", 401);
    }

    c.set("wsUserId", user.id);
    await next();
  },
  upgradeWebSocket((c) => {
    const wsUserId = c.get("wsUserId");

    return {
    onOpen() {
        console.log(`New WebSocket connection for user ${wsUserId}`);
    },
    onMessage(event, ws) {
        ws.send(`${event.data} | user=${wsUserId}`);
    },
    };
  }),
);

const server = serve(
  {
    fetch: app.fetch,
    port: 4200,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

injectWebSocket(server);
