/**
 * Output-equivalent fast path (2026-11-19, İstanbul→Kelkit profile: ~0.5 s per plan in duplicate validation).
 * trustedWeatherForecasts: arrays returned by WeatherService.forecast. Every element was built by normalizeWeather (which
 * parses with weatherForecastSchema) or unavailableForecast (a fixed valid shape), so a consumer may skip re-parsing it.
 * trustedWeatherQueries: query arrays built by the planning session itself; WeatherService skips only the schema parse
 * (size and duplicate-id guards stay). Membership is by array identity; any other array is parsed as before.
 */
export const trustedWeatherForecasts=new WeakSet<object>();
export const trustedWeatherQueries=new WeakSet<object>();
