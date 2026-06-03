declare module "@xnfa/qq-music-api" {
  const api: {
    api(path: string, query?: Record<string, unknown>): Promise<unknown>;
    setCookie(cookie: string | Record<string, string>): void;
  };

  export default api;
}

declare module "@neteasecloudmusicapienhanced/api/generateConfig.js" {
  export default function generateConfig(): Promise<void>;
}
