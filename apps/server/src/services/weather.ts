type GeocodingResponse = {
  results?: Array<{
    name: string;
    country?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
  }>;
};

type ForecastResponse = {
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

export type WeatherSummary = {
  city: string;
  locationLabel: string;
  latitude: number;
  longitude: number;
  current: {
    temperatureC: number;
    apparentTemperatureC: number;
    windSpeedKmh: number;
    weatherCode: number;
    weatherLabel: string;
  };
  today: {
    minC: number | null;
    maxC: number | null;
  };
  summary: string;
  fetchedAt: string;
};

const WEATHER_LABELS: Record<number, string> = {
  0: "晴朗",
  1: "大部晴朗",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "冻雾",
  51: "小毛雨",
  53: "毛雨",
  55: "强毛雨",
  56: "冻毛雨",
  57: "强冻毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "小阵雨",
  81: "阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "强阵雪",
  95: "雷暴",
  96: "雷暴夹小冰雹",
  99: "雷暴夹大冰雹"
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function getWeatherLabel(code: number) {
  return WEATHER_LABELS[code] ?? `天气代码 ${code}`;
}

export async function getWeatherSummary(city: string): Promise<WeatherSummary> {
  const trimmedCity = city.trim();
  if (!trimmedCity) {
    throw new Error("City is required.");
  }

  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", trimmedCity);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "zh");
  geocodingUrl.searchParams.set("format", "json");

  const geocodingResponse = await fetch(geocodingUrl, {
    signal: AbortSignal.timeout(15000)
  });
  if (!geocodingResponse.ok) {
    throw new Error(`Weather geocoding failed with status ${geocodingResponse.status}.`);
  }

  const geocoding = (await geocodingResponse.json()) as GeocodingResponse;
  const hit = geocoding.results?.[0];
  if (!hit) {
    throw new Error("No matching city was found.");
  }

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(hit.latitude));
  forecastUrl.searchParams.set("longitude", String(hit.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m");
  forecastUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  forecastUrl.searchParams.set("timezone", "auto");
  forecastUrl.searchParams.set("forecast_days", "1");

  const forecastResponse = await fetch(forecastUrl, {
    signal: AbortSignal.timeout(15000)
  });
  if (!forecastResponse.ok) {
    throw new Error(`Weather forecast failed with status ${forecastResponse.status}.`);
  }

  const forecast = (await forecastResponse.json()) as ForecastResponse;
  const current = forecast.current;
  if (!current) {
    throw new Error("Weather forecast returned no current data.");
  }

  const minC = forecast.daily?.temperature_2m_min?.[0];
  const maxC = forecast.daily?.temperature_2m_max?.[0];
  const weatherLabel = getWeatherLabel(current.weather_code);
  const locationLabel = [hit.name, hit.admin1, hit.country].filter(Boolean).join(" / ");

  return {
    city: trimmedCity,
    locationLabel,
    latitude: hit.latitude,
    longitude: hit.longitude,
    current: {
      temperatureC: round(current.temperature_2m),
      apparentTemperatureC: round(current.apparent_temperature),
      windSpeedKmh: round(current.wind_speed_10m),
      weatherCode: current.weather_code,
      weatherLabel
    },
    today: {
      minC: typeof minC === "number" ? round(minC) : null,
      maxC: typeof maxC === "number" ? round(maxC) : null
    },
    summary: `${locationLabel} 今天${weatherLabel}，当前 ${round(current.temperature_2m)}°C，体感 ${round(
      current.apparent_temperature
    )}°C，风速 ${round(current.wind_speed_10m)} km/h${
      typeof minC === "number" && typeof maxC === "number" ? `，今日 ${round(minC)}°C 到 ${round(maxC)}°C。` : "。"
    }`,
    fetchedAt: new Date().toISOString()
  };
}
