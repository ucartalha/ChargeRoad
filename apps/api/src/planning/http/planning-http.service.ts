import {Injectable,HttpException,Logger} from '@nestjs/common';
import {planningApiResponseSchema,planningEvaluationSchema,planningResultSchema} from '@chargeroad/shared';
import type {PlanningApiRequest,PlanningApiResponse,RoutePlanRequest} from '@chargeroad/shared';
import {canonicalJson} from '../../vehicles/knowledge/knowledge-package';
import {EvPlanningService} from '../ev-planning.service';
import {DEFAULT_OPTIMIZER_OPTIONS,OPTIMIZER_VERSION} from '../optimizer-policy';
import {ENERGY_ALGORITHM_VERSION} from '../../energy/energy-policy';
import {CHARGING_ALGORITHM_VERSION} from '../../charging/charging-engine';
import {PlanningExecution} from './planning-execution';
import {PLANNING_HTTP_POLICY,toInternalRequest,planningPreparation} from './planning-http-policy';
@Injectable()
export class PlanningHttpService {
  private readonly logger=new Logger(PlanningHttpService.name);
  constructor(private readonly planner:EvPlanningService,private readonly execution:PlanningExecution){}
  async plan(request:PlanningApiRequest,signal:AbortSignal,serverBudgetMs?:number):Promise<PlanningApiResponse>{
    const began=performance.now();
    let expected:RoutePlanRequest|undefined;
    const outcome=await this.execution.run((bounded,budget)=>{expected=toInternalRequest(request,budget);const preparation=planningPreparation(request),options=structuredClone(DEFAULT_OPTIMIZER_OPTIONS);
      options.maxWeatherQueries=preparation.maxWeatherQueries;return this.planner.plan(expected,preparation,options,bounded);},signal,serverBudgetMs);
    if(!planningResultSchema.safeParse(outcome.result).success||outcome.result.status!=='planned'&&outcome.result.requestId!==request.requestId)
      throw new HttpException({code:'PLANNING_RESPONSE_INVALID'},500);
    // Correlation and bounded diagnostic codes only: never log coordinates, SOC, IP, provider packets or secrets.
    this.logger.log(JSON.stringify({event:'planning_completed',requestId:request.requestId,status:outcome.result.status,
      reasons:outcome.result.status==='planned'?[]:outcome.result.reasons.map(r=>r.code).slice(0,20),
      skippedData:outcome.search?.skippedData.slice(0,20)??[],elapsedMs:Math.round(performance.now()-began)}));
    if(outcome.result.status==='planned'){
      if(!outcome.validationInput)throw new HttpException({code:'PLANNING_RESPONSE_INVALID'},500);
      try{planningEvaluationSchema.parse({input:outcome.validationInput,result:outcome.result});}catch{throw new HttpException({code:'PLANNING_RESPONSE_INVALID'},500);}
      const {vehicleVariantId:canonicalId,...actual}=outcome.validationInput.request;
      const {vehicleVariantId:requestedId,...submitted}=expected!;
      if(canonicalJson(actual)!==canonicalJson(submitted))throw new HttpException({code:'PLANNING_RESPONSE_INVALID'},500);
    }
    const vehicle=outcome.result.status==='planned'?outcome.validationInput?.vehicle:null;
    const explanations:Record<string,string>={VEHICLE_ENERGY_PROFILE_MISSING:'Seçilen araç için planlamaya yeterli enerji profili bulunmuyor.',
      ENERGY_CALIBRATION_MISSING:'Seçilen aracın tüketim modeli henüz hazır değil.',ENGINEERING_ESTIMATE_NOT_ALLOWED:'Bu araç profili mühendislik tahminleri içeriyor; kullanımı ayrıca seçilmelidir.',
      INITIAL_RESERVE_NOT_MET:'Başlangıç şarjı seçtiğiniz minimum rezervin altında.',DEPARTURE_OUTSIDE_72_HOUR_WINDOW:'Ayrıntılı enerji planı için hareket zamanı önümüzdeki 72 saat içinde olmalı.',
      ROAD_ROUTE_NOT_FOUND:'Girilen konumlar arasında yol bulunamadı.',PLANNING_DATA_INCOMPLETE:'Güvenilir plan için gerekli araç, istasyon veya hava verilerinin bir bölümü eksik.',
      ROAD_ENDPOINT_CONFIRMATION_REQUIRED:'Seçtiğin konum yolun üzerinde değil. Haritadaki yakın yol noktasını başlangıç/varış olarak onaylayabilirsin.',
      ROAD_ENDPOINT_NOT_REACHABLE:'Seçtiğin konuma yakın sürülebilir yol bulunamadı. Daha kesin bir sokak veya bina adresi seç.',
      NO_VALID_PLAN_WITHIN_DATA_BUDGET:'Bu uzun rotada veri değerlendirme sınırına ulaşıldı. Konum ve şarj tercihleriniz korunuyor.',
      ROAD_PROVIDER_QUOTA_EXHAUSTED:'Geliştirme yol servisinin günlük istek bütçesi doldu. Yeni yol verisi şu anda alınamıyor; konum ve şarj tercihleriniz korunuyor.',
      ROAD_PROVIDER_BACKOFF:'Yol servisi bekleme süresinde. Belirtilen süre dolmadan yeniden istek göndermeyeceğiz.',
      ROAD_PROVIDER_NOT_CONFIGURED:'Yol sağlayıcısının sunucu bağlantısı henüz yapılandırılmadı.',
      ROAD_PROVIDER_RATE_LIMITED:'Yol sağlayıcısı geçici istek sınırı bildirdi. Bekleme süresinden sonra tekrar deneyebilirsin.',
      ROAD_PROVIDER_PACING_LIMIT:'Yol servisi şu anda diğer istekleri işliyor. Kısa süre sonra tekrar deneyebilirsin.',
      ROAD_ACQUISITION_BUDGET:'Bu planın yol verisi edinme sınırına ulaşıldı; mevcut tercihler korunuyor.',
      PHYSICAL_DC_EVSE_DATA_MISSING:'Güzergâhtaki istasyonların DC soket bilgileri şarj planını doğrulamak için yeterli değil. Yol önizlemesiyle devam edebilirsin.',
      ROAD_TIME_OR_TRACE_EXCEEDS_SPEED_LIMIT:'Yol sağlayıcısının süre ve hız sınırı bilgileri birbiriyle uyuşmuyor. Enerji ve varış şarjı hesabı doğrulanamadı.',
      WEATHER_CORE_OR_FRESHNESS_MISSING:'Güzergâh için güncel sıcaklık veya rüzgâr verisi alınamadı. Yol önizlemesiyle devam edebilirsin.',
      NO_FEASIBLE_PLAN_IN_BOUNDED_SEARCH:'Değerlendirilen seçeneklerde koşullarınıza uygun plan bulunamadı.'};
    const fallback=outcome.result.status==='provider_error'?'Veri sağlayıcısına erişilemedi; kısa süre sonra tekrar deneyin.':
      outcome.result.status==='computation_limit'?'Hesaplama sınırı içinde doğrulanmış bir plan bulunamadı.':'Planlama için gerekli veriler veya koşullar yeterli değil.';
    const result=outcome.result.status==='planned'?{status:'planned' as const,plan:outcome.result.plan}:{status:outcome.result.status,
      reasons:outcome.result.reasons.map(r=>({code:r.code,explanation:explanations[r.code]??fallback}))};
    const parsed=planningApiResponseSchema.safeParse({schemaVersion:'1.0.0',requestId:request.requestId,...result,metadata:{apiVersion:'planning-http/1.0.0',
      policyId:PLANNING_HTTP_POLICY.id,policyVersion:PLANNING_HTTP_POLICY.version,access:'stateless_guest',historyStored:false,
      ...(outcome.retryAfterSeconds?{retryAfterSeconds:outcome.retryAfterSeconds}:{}),
      algorithms:{optimizer:OPTIMIZER_VERSION,energy:ENERGY_ALGORITHM_VERSION,charging:CHARGING_ALGORITHM_VERSION},
      models:{energy:vehicle?.energyModel?{id:vehicle.energyModel.id,version:vehicle.energyModel.version}:null,
        charging:vehicle?.chargingModel?{id:vehicle.chargingModel.id,version:vehicle.chargingModel.version}:null}}});
    if(!parsed.success)throw new HttpException({code:'PLANNING_RESPONSE_INVALID'},500);
    if(Buffer.byteLength(JSON.stringify(parsed.data))>PLANNING_HTTP_POLICY.maxResponseBytes)throw new HttpException({code:'PLANNING_RESPONSE_LIMIT'},503);
    return parsed.data;
  }
}
