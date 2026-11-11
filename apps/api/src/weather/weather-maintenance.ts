import {Injectable,Logger} from '@nestjs/common';
import type {OnModuleDestroy,OnModuleInit} from '@nestjs/common';
import {WeatherService} from './weather.service';

// Local timer, shared indexed DB deletion. No weather polling, queue or Redis dependency.
@Injectable()
export class WeatherMaintenance implements OnModuleInit,OnModuleDestroy {
  private timer:ReturnType<typeof setInterval>|undefined;
  private running=false;
  constructor(private readonly weather:WeatherService){}
  onModuleInit(){this.timer=setInterval(()=>{void this.sweep();},15*60*1000);this.timer.unref();}
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
  async sweep(){if(this.running)return;this.running=true;
    try{await this.weather.cleanup();}catch{new Logger(WeatherMaintenance.name).error('Weather cache cleanup failed');}
    finally{this.running=false;}
  }
}
