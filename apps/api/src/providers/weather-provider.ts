import type { WeatherForecast, WeatherQuery } from '@chargeroad/shared' with { 'resolution-mode': 'import' };

// Each query carries its own position and predicted passage time.
export interface WeatherProvider {
  forecast(queries: WeatherQuery[]): Promise<WeatherForecast[]>;
}
