import "server-only";

import { addDays } from "@/lib/rota/forecasting";
import { environment } from "@/lib/env";

export type WeatherSignal = {
  date: string;
  temperatureMax: number | null;
  temperatureMin: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  summary: string;
};

export type NearbyEventSignal = {
  date: string;
  title: string;
  venue: string | null;
  category: string | null;
};

export type ExternalRotaSignals = {
  weather: WeatherSignal[];
  events: NearbyEventSignal[];
  weatherConfigured: boolean;
  eventsConfigured: boolean;
  warning: string | null;
};

const weatherSummary = (code: number | null, precipitation: number | null) => {
  if (precipitation != null && precipitation >= 8) return "Heavy rain risk";
  if (precipitation != null && precipitation >= 2) return "Rain likely";
  if (code == null) return "Forecast available";
  if (code <= 1) return "Clear or mainly clear";
  if (code <= 3) return "Cloudy";
  if (code >= 95) return "Thunderstorm risk";
  if (code >= 71) return "Snow risk";
  if (code >= 51) return "Showers possible";
  return "Mixed conditions";
};

export async function getExternalRotaSignals(weekStart: string): Promise<ExternalRotaSignals> {
  const weekEnd = addDays(weekStart, 6);
  const [weather, events] = await Promise.allSettled([
    getWeather(weekStart, weekEnd),
    getEvents(weekStart, weekEnd),
  ]);

  const weatherValue = weather.status === "fulfilled" ? weather.value : [];
  const eventValue = events.status === "fulfilled" ? events.value : [];
  const warning = [
    weather.status === "rejected" ? "Weather signal unavailable" : null,
    events.status === "rejected" ? "Event signal unavailable" : null,
  ].filter(Boolean).join(" · ") || null;

  return {
    weather: weatherValue,
    events: eventValue,
    weatherConfigured: true,
    eventsConfigured: Boolean(environment.ticketmasterApiKey),
    warning,
  };
}

async function getWeather(startDate: string, endDate: string): Promise<WeatherSignal[]> {
  const params = new URLSearchParams({
    latitude: String(environment.rotaWeatherLatitude),
    longitude: String(environment.rotaWeatherLongitude),
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "Europe/London",
    start_date: startDate,
    end_date: endDate,
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  const payload = await response.json() as { daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[] } };
  const days = payload.daily?.time ?? [];
  return days.map((date, index) => {
    const precipitationMm = payload.daily?.precipitation_sum?.[index] ?? null;
    const weatherCode = payload.daily?.weather_code?.[index] ?? null;
    return {
      date,
      temperatureMax: payload.daily?.temperature_2m_max?.[index] ?? null,
      temperatureMin: payload.daily?.temperature_2m_min?.[index] ?? null,
      precipitationMm,
      weatherCode,
      summary: weatherSummary(weatherCode, precipitationMm),
    };
  });
}

async function getEvents(startDate: string, endDate: string): Promise<NearbyEventSignal[]> {
  if (!environment.ticketmasterApiKey) return [];
  const params = new URLSearchParams({
    apikey: environment.ticketmasterApiKey,
    city: environment.rotaEventsCity,
    countryCode: "GB",
    locale: "en-gb",
    size: "40",
    sort: "date,asc",
    startDateTime: `${startDate}T00:00:00Z`,
    endDateTime: `${addDays(endDate, 1)}T00:00:00Z`,
  });
  const response = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`, { next: { revalidate: 21600 } });
  if (!response.ok) throw new Error(`Ticketmaster ${response.status}`);
  const payload = await response.json() as { _embedded?: { events?: Array<{ name?: string; dates?: { start?: { localDate?: string } }; classifications?: Array<{ segment?: { name?: string } }>; _embedded?: { venues?: Array<{ name?: string }> } }> } };
  return (payload._embedded?.events ?? []).flatMap((event) => {
    const date = event.dates?.start?.localDate;
    if (!date || !event.name) return [];
    return [{
      date,
      title: event.name,
      venue: event._embedded?.venues?.[0]?.name ?? null,
      category: event.classifications?.[0]?.segment?.name ?? null,
    }];
  });
}
