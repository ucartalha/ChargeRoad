import { BadRequestException,Controller,Get,NotFoundException,Param,Query } from '@nestjs/common';
import { z } from 'zod';
import { StationsRepository } from './stations.repository';
import { RateLimitPolicy } from '../security/rate-limit.guard';

const coordinate=(min:number,max:number)=>z.string().regex(/^-?\d+(?:\.\d+)?$/).transform(Number).pipe(z.number().finite().min(min).max(max));
const integer=(min:number,max:number)=>z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const viewport=z.object({west:coordinate(-180,180),east:coordinate(-180,180),south:coordinate(-90,90),north:coordinate(-90,90),
  limit:integer(1,100).optional().default(50),offset:integer(0,1000000).optional().default(0)}).strict()
  .refine(b=>b.west<b.east&&b.south<b.north&&b.east-b.west<=5&&b.north-b.south<=5,'Viewport exceeds policy');
@Controller('stations')
@RateLimitPolicy('catalogue')
export class StationsController {
  constructor(private readonly repository:StationsRepository){}
  @Get()
  list(@Query() raw:Record<string,unknown>){
    const parsed=viewport.safeParse(raw);
    if(!parsed.success)throw new BadRequestException('Valid bounded viewport is required');
    return this.repository.list(parsed.data);
  }
  @Get(':id')
  async detail(@Param('id') id:string){
    if(!z.string().uuid().safeParse(id).success)throw new NotFoundException('Station not found');
    const result=await this.repository.detail(id);if(!result)throw new NotFoundException('Station not found');return result;
  }
}
