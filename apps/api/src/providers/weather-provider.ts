import type { WeatherForecast, WeatherQuery } from '@chargeroad/shared' with { 'resolution-mode': 'import' };
import type { ProviderResponse } from './provider-response';
import type {WeatherAtlas} from '../weather/weather-atlas';
export interface WeatherForecastContext {budgetScope:object;maxExternalCalls?:number;seriesScope?:WeatherAtlas;}

// Each query carries its own position and predicted passage time.
export abstract class WeatherProvider {
  readonly departureWindowSeconds?:number;
  abstract forecast(queries: WeatherQuery[], signal: AbortSignal,context?:WeatherForecastContext): Promise<ProviderResponse<WeatherForecast[]>>;
}
