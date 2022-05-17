import { withQuery } from "ufo";
import { normalizeError, isJsonRequest } from "#nitro/utils";
export default async function handleError(error, event) {
  const { stack, statusCode, statusMessage, message } = normalizeError(error);
  const errorObject = {
    url: event.req.url,
    statusCode,
    statusMessage,
    message,
    description: process.env.NODE_ENV === "development" && statusCode !== 404 ? `<pre>${stack.map((i) => `<span class="stack${i.internal ? " internal" : ""}">${i.text}</span>`).join("\n")}</pre>` : ""
  };
  event.res.statusCode = error.statusCode || 500;
  event.res.statusMessage = error.statusMessage || "Internal Server Error";
  if (error.statusCode !== 404) {
    console.error("[nuxt] [request error]", error.message + "\n" + stack.map((l) => "  " + l.text).join("  \n"));
  }
  if (isJsonRequest(event)) {
    event.res.setHeader("Content-Type", "application/json");
    return event.res.end(JSON.stringify(errorObject));
  }
  const url = withQuery("/__nuxt_error", errorObject);
  const html = await $fetch(url).catch(() => errorObject.statusMessage);
  event.res.setHeader("Content-Type", "text/html;charset=UTF-8");
  return event.res.end(html);
}
