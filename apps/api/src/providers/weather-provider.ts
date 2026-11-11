import type { WeatherForecast, WeatherQuery } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';

// Each query carries its own position and predicted passage time.
export abstract class WeatherProvider {
  readonly departureWindowSeconds?:number;
  abstract forecast(queries: WeatherQuery[], signal: AbortSignal): Promise<ProviderResponse<WeatherForecast[]>>;
}
