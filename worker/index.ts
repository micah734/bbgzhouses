import handler from "vinext/server/app-router-entry";

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: Parameters<typeof handler.fetch>[2]) {
    return handler.fetch(request, env, ctx);
  },
};
