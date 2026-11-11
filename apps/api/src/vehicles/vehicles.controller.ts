import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { VehiclesRepository } from './vehicles.repository';
import { RateLimitPolicy } from '../security/rate-limit.guard';

const boundedInteger = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
export const vehicleFiltersSchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  make: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  year: boundedInteger(1900, 2100).optional(),
  market: z.string().regex(/^[A-Z]{2}$/).optional(),
  limit: boundedInteger(1, 100).optional().default(25),
  offset: boundedInteger(0, 1_000_000).optional().default(0),
}).strict();

@Controller('vehicles')
@RateLimitPolicy('catalogue')
export class VehiclesController {
  constructor(private readonly repository: VehiclesRepository) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const parsed = vehicleFiltersSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid vehicle filters');
    return this.repository.list(parsed.data);
  }

  @Get('makes')
  makes() {
    return this.repository.makes();
  }

  @Get('models')
  models(@Query() query: Record<string, unknown>) {
    const parsed = z.object({ make: z.string().min(1).max(100) }).strict().safeParse(query);
    if (!parsed.success) throw new BadRequestException('A make slug is required');
    return this.repository.models(parsed.data.make);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!validVehicleId(id)) throw new NotFoundException('Vehicle not found');
    const vehicle = await this.repository.findById(id);
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  @Get(':id/references')
  async references(@Param('id') id: string,@Query() query:Record<string,unknown>) {
    if (!validVehicleId(id)) throw new NotFoundException('Vehicle not found');
    const options=z.object({limit:boundedInteger(1,100).optional().default(50),offset:boundedInteger(0,1_000_000).optional().default(0)})
      .strict().safeParse(query);
    if (!options.success) throw new BadRequestException('Invalid reference pagination');
    const references = await this.repository.references(id,options.data);
    if (references === null) throw new NotFoundException('Vehicle not found');
    return references;
  }
}

function validVehicleId(id: string) {
  return /^[a-f0-9]{64}$/.test(id) || z.string().uuid().safeParse(id).success;
}
