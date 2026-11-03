import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// 中立性（specs/provider-neutrality.md 规则 6）：开发脚本不内置品牌端点/模型默认值。
const baseURL = process.env.RASPBERRYCODE_BASE_URL;
const model = process.env.RASPBERRYCODE_MODEL;
if (!baseURL || !model) {
  console.error("Set RASPBERRYCODE_BASE_URL and RASPBERRYCODE_MODEL before running this scratch script.");
  process.exit(1);
}

const client = createAnthropic({
  apiKey: process.env.RASPBERRYCODE_API_KEY,
  baseURL,
});

const result = await generateText({
  model: client(model),
  prompt: "say hello in 3 words",
});

console.log("Result:", result);
