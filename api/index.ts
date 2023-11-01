import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/vercel";
import { createClient } from "@vercel/kv";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const kv = createClient({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
  automaticDeserialization: false,
});

const instanceKeyPrefix = "kai-";

const util = {
  // min <= random(min, max) < max
  randomInt: (min = 100000, max = 1000000) => Math.floor(Math.random() * (Math.floor(max) - Math.ceil(min)) + Math.ceil(min)),
  createInstance: async (id: string, password: string, content: string) => {
    const key = instanceKeyPrefix + id;
    const evaluation = await kv.eval('if redis.call("EXISTS",KEYS[1])==0 then redis.call("HSET",KEYS[1],"password",ARGV[1],"content",ARGV[2])return redis.call("EXPIRE",KEYS[1],"600")end;return 503', [key], [password, content]);
    // 成功创建且设置过期
    if (evaluation === 1) {
      return { success: true, message: "成功创建", data: { id } };
    } else if (evaluation === 503) {
      return { success: false, message: "目前服务器实例过多或运气不好" };
    } else {
      return { success: false, message: "其他错误" };
    }
  },
  saveInstance: async (id: string, password: string, content: string) => {
    const key = instanceKeyPrefix + id;
    const evaluation = await kv.eval('local a=redis.call("HGET",KEYS[1],"password")if a then if a==ARGV[1]then redis.call("HSET",KEYS[1],"content",ARGV[2])return redis.call("EXPIRE",KEYS[1],"600")end;return 403 end;return 404', [key], [password, content]);
    if (evaluation === 1) {
      return { success: true, message: "成功保存", data: { id } };
    } else if (evaluation === 403) {
      return { success: false, message: "密码错误" };
    } else if (evaluation === 404) {
      return { success: false, message: "不存在ID对应的实例" };
    } else {
      return { success: false, message: "其他错误" };
    }
  },
  pullInstance: async (id: string, password: string) => {
    const key = instanceKeyPrefix + id;
    const evaluation = await kv.eval('local a=redis.call("HGET",KEYS[1],"password")if a then if a==ARGV[1]then redis.call("EXPIRE",KEYS[1],"600")return redis.call("HGET",KEYS[1],"content")end;return 403 end;return 404', [key], [password]);
    if (typeof evaluation === "string") {
      return { success: true, message: "成功拉取", data: { id, content: evaluation } };
    } else if (evaluation === 403) {
      return { success: false, message: "密码错误" };
    } else if (evaluation === 404) {
      return { success: false, message: "不存在ID对应的实例" };
    } else {
      return { success: false, message: "其他错误" };
    }
  },
  destroyInstance: async (id: string, password: string) => {
    const key = instanceKeyPrefix + id;
    const evaluation = await kv.eval('local a=redis.call("HGET",KEYS[1],"password")if a then if a==ARGV[1]then return redis.call("DEL",KEYS[1])end;return 403 end;return 404', [key], [password]);
    if (evaluation === 1) {
      return { success: true, message: "成功销毁", data: { id } };
    } else if (evaluation === 403) {
      return { success: false, message: "密码错误" };
    } else if (evaluation === 404) {
      return { success: false, message: "不存在对应的实例" };
    } else {
      return { success: false, message: "其他错误" };
    }
  },
  validator: (schema: z.ZodType<any, z.ZodTypeDef, any>) =>
    zValidator("json", schema, (result, c) => {
      if (!result.success) {
        return c.json({ success: false, message: JSON.stringify(result.error.issues) });
      }
    }),
};

export const config = {
  runtime: "edge",
};

const app = new Hono().basePath("/api");

const noidSchema = z.object({
  password: z.string(),
  content: z.string(),
});
const nocontentSchema = z.object({
  id: z.string(),
  password: z.string(),
});
const idSchema = z.object({
  id: z.string(),
  password: z.string(),
  content: z.string(),
});
app.use("*", cors());
app.get("/", (c) => c.html("<h1>Welcome to Kai's api!</h1>"));
app.post("/instance/create", util.validator(noidSchema), async (c) => {
  const data = c.req.valid("json");
  const response = await util.createInstance(util.randomInt().toString(), data.password, data.content);
  return c.json(response);
});
app.post("/instance/save", util.validator(idSchema), async (c) => {
  const data = c.req.valid("json");
  const response = await util.saveInstance(data.id.toString(), data.password, data.content);
  return c.json(response);
});
app.post("/instance/pull", util.validator(nocontentSchema), async (c) => {
  const data = c.req.valid("json");
  const response = await util.pullInstance(data.id.toString(), data.password);
  return c.json(response);
});
app.post("/instance/destroy", util.validator(nocontentSchema), async (c) => {
  const data = c.req.valid("json");
  const response = await util.destroyInstance(data.id.toString(), data.password);
  return c.json(response);
});

export default handle(app);
