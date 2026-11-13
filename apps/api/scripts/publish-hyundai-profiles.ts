import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseService} from '../src/database/database.service';
import {VehicleKnowledgeRepository} from '../src/vehicles/knowledge/knowledge.repository';
import {parseKnowledgePackage} from '../src/vehicles/knowledge/knowledge-package';
import type {KnowledgePackage,KnowledgeRecord,VehicleEnergyProfile,EnergyModel,SourceReference} from '@chargeroad/shared';
const root=resolve(__dirname,'../../..'),version='hyundai-engineering/1.0.2';
async function main(){const directory=resolve(root,'artifacts/hyundai-research'),inventory=JSON.parse(await readFile(resolve(directory,'inventory.json'),'utf8'));
  const raw=JSON.parse(await readFile(resolve(directory,'kilowatt.json'),'utf8')),pin=JSON.parse(await readFile(resolve(directory,'source.json'),'utf8'));
  const now=pin.retrievedAt,method:SourceReference={sourceId:'chargeroad-hyundai-engineering',recordId:version,version,
    url:'https://github.com/KilowattApp/open-ev-data',retrievedAt:now,publishedAt:null,license:'ChargeRoad own engineering derivation; upstream MIT with Attribution Requirement / CDLA-Permissive-2.0'};
  const upstream:SourceReference={sourceId:'kilowatt-open-ev-data',recordId:pin.commit,version:pin.commit,
    url:'https://github.com/KilowattApp/open-ev-data/blob/'+pin.commit+'/data/ev-data.json',retrievedAt:now,publishedAt:null,license:'MIT with Attribution Requirement'};
  const used=new Map<string,unknown>(),summaries:unknown[]=[];
  const records:KnowledgeRecord[]=inventory.map((row:any)=>{
    const d=row.detail,id='hyundai-estimate:'+row.entity_id,model=d.model.toLowerCase(),is6=model.includes('6'),is9=model.includes('9'),kona=model.includes('kona'),n=d.trim==='N',awd=/awd/i.test(d.trim+' '+d.variant);
    const small6=is6&&(d.grossBatteryKwh===53||d.marketedBatteryKwh===53),pilot5=d.marketedBatteryKwh===63,smallKona=kona&&(d.grossBatteryKwh??0)<50;
    const sourceId=is6?(small6?'4dd44dba-266f-4307-9604-fa6b594c48a2':awd?'757a6759-bb9f-4fe6-9cc1-6aa90f858b62':'43e5be03-74f8-4686-9437-1d7e04df59fc'):
      kona?(smallKona?'7a8b44ba-f0d4-4b51-930f-074a66e0cbac':'c1fd1277-5d77-416b-bb25-84bd21f57963'):
      n?'0ffb84fb-64a0-4037-8060-17a9037bd016':awd||is9?'5cefadb7-a8e5-1f4d-ff3a-532384c19207':pilot5?'e8777629-bb49-7ec7-6f09-d81457023b7c':'b58bc94d-d929-ad71-d95b-08b877bf76ba';
    const input=raw.data.find((r:any)=>r.id===sourceId);if(!input)throw new Error('Missing pinned source record');used.set(sourceId,input);
    const capacity=d.usableBatteryKwh??(small6?50:pilot5?63*.95:null);if(!capacity)throw new Error('No explicit usable capacity derivation');
    const range=d.rangeRatings?.find((r:any)=>r.profile==='wltp')?.rangeKm;
    const average=is9&&range?capacity/range*100*1.25:input.energy_consumption.average_consumption;
    const mass=kona?1685:is6?(small6?1775:1950)+(awd?100:0):is9?2650:n?2235:2010+(awd?100:0),drag=kona?.72:is6?.55:is9?.95:n?.83:.78;
    const efficiency=.91,baseAux=.4,rho=1.225,anchorSpeed=90/3.6;
    // 1 kWh / 100 km = 36 N of mean road force; keep this conversion explicit.
    const rolling=Math.max(.006,Math.min(.02,((average-baseAux/90*100)*36*efficiency-.5*rho*drag*anchorSpeed**2)/(mass*9.80665)));
    const peak=kona?(smallKona?44:77):small6?170:pilot5?175:is9?250:220;
    const voltage=kona?360:small6?480:is9?610:697;
    const assumptions=[
      'Kaynak ortalamaları bağımsız sabit hız testleri değildir; 90 km/h temsilî mühendislik ankrajı varsayılmıştır.',
      'Hız ve sıcaklık kırılımları fizik tabanlı türetimdir; ölçülmüş internet testleri olarak sunulmaz. Saha hata payı henüz belirlenmedi.',
      `Kaynak eşleştirmesi ${input.model} / ${input.variant}; aynı batarya/çekiş ailesinden yıl aktarımı yaklaşık olarak yapılır.`,
      'Bilinmeyen SOH %95, ek yük 100 kg, klima 1 kW ve ilk batarya sıcaklığı dış havaya eşit varsayılır; bunlar gözlem değildir.',
      'Şarj voltajı SOC boyunca yaklaşık modellenir; soğukta güç düşürülür; ısıtma/ön koşullandırma tamamlandı varsayılmaz.',
      'Nominal 800V mimari gerçek inlet voltajı değildir; voltaj/akım ve istasyon sınırları ayrıca uygulanır.',
      'Eski katalogdaki bilinen kullanılabilir kapasite korunur; pilot 63 kWh paket için %95 kullanılabilir oranı mühendislik tahminidir.',
      ...(is9?['IONIQ 9 ortalaması kendi katalog WLTP menzili/kapasitesi ve 1.25 gerçek kullanım katsayısından türetilmiştir; bağımsız IONIQ 5 verisiyle eşitlenmez.']:[]),
      ...(input.dc_charger.max_power===input.usable_battery_size?['Kaynak DC gücü kapasiteyle aynı göründüğünden şüpheli güç/eğri doğrudan kullanılmadı.']:[])];
    const catalogueSource:SourceReference={sourceId:d.source.key,recordId:d.source.vehicleId,version:d.source.version,url:d.source.homepageUrl,retrievedAt:d.source.fetchedAt,
      publishedAt:null,license:d.source.license};
    const evidence={quality:'engineering_estimate' as const,source:method,verificationNote:'Kaynaklı yaklaşık başlangıç profili; ölçülmüş varyant testi veya saha doğruluğu garantisi değildir.',
      derivation:{methodId:'hyundai-licensed-baseline-physics',version:'1.0.0',inputReferences:[upstream,catalogueSource],assumptions,applicability:`${d.model} ${d.modelYear} ${d.trim}; yalnız seçili varyant`,uncertainty:'Başlangıç modeli: tüketim, termal ve şarj varsayımları kalibre edilmemiştir; sayısal güven aralığı verilmez.'}};
    const energy:EnergyModel={id:id+':energy',version,vehicleVariantId:id,quality:'engineering_estimate',source:method,verificationNote:evidence.verificationNote,assumptions,
      tireSetupId:null,referenceTireDescription:d.wheelInches?d.wheelInches+' inch':'Unknown OEM wheel; family baseline',mode:'physics',speedPolicy:'allow_travel_average_proxy',ambientRangeC:{min:-25,max:45},
      referenceAirDensityKgPerM3:rho,referenceCabinKw:0,referenceBatteryThermalKw:0,baseAuxiliaryKw:baseAux,
      cabin:{heatKwPerDegree:.075,coolKwPerDegree:.09,maxKw:5},batteryThermalKw:0,
      regeneration:{efficiency:.65,temperatureRangeC:{min:-30,max:55},taperStartSocPercent:90,zeroAtSocPercent:100},
      rotationalMassFactor:1.04,maxTractionBatteryKw:null,wetRollingMultiplier:1.08,snowRollingMultiplier:1.25,capacityTemperatureCurve:null,
      passiveThermal:{heatCapacityKwhPerC:capacity*.012,conductanceKwPerC:.012},
      unknowns:{initialBatteryTemperature:'ambient_equilibrium',payloadKg:100,sohPercent:95,cabinTargetC:22,hvacKw:1,capacityTemperatureFactor:1,airDensityKgPerM3:rho,allowFlatElevation:true}};
    const refs=[0,20,35].flatMap(temp=>[30,50,70,90,110,130,150].map(speed=>{
      const density=rho*293.15/(273.15+temp),cabin=temp<18?(22-temp)*.075:temp>25?(temp-22)*.09:0;
      return {id:id+`:speed-${speed}-temp-${temp}`,vehicleVariantId:id,version,comparabilityGroupId:id+':derived-speed-grid',
        valueKwhPer100Km:((mass*9.80665*rolling+.5*density*drag*(speed/3.6)**2)/efficiency/36+(baseAux+cabin)/speed*100),energyBoundary:'battery_dc' as const,basis:'derived' as const,
        testCycle:'constant_speed' as const,drivingProfile:speed<70?'city' as const:'highway' as const,
        conditions:{meanSpeedKph:speed,ambientTemperatureC:{min:temp,max:temp},batteryTemperatureC:null,payloadKg:0,windSpeedKph:0,elevationGainMetersPer100Km:0,tireDescription:energy.referenceTireDescription},
        includedEffects:{cabinHvac:'included' as const,batteryThermalManagement:'excluded' as const,elevation:'included' as const,wind:'included' as const,chargingLosses:'excluded' as const},batteryDcConversion:null,source:method};}));
    const pathId=id+':native',soc=[0,10,20,40,55,65,75,80,85,90,95,100],shape=[.55,.85,.95,1,1,.9,.7,.5,.4,.25,.15,.04];
    const curves=[{tag:'cold',min:-30,max:10,factor:.45},{tag:'cool',min:10,max:20,factor:.7},{tag:'mild',min:20,max:55,factor:1}].map(band=>({
      id:id+':curve-'+band.tag,version,vehicleVariantId:id,chargingPathId:pathId,semantics:'vehicle_acceptance_limit' as const,powerBoundary:'vehicle_inlet' as const,
      curve:{representation:'power_by_soc' as const,points:soc.map((s,i)=>({socPercent:s,powerKw:peak*shape[i]*band.factor,voltageV:voltage*(.9+.2*s/100),batteryTemperatureC:null}))},
      interpolation:'linear' as const,extrapolation:'forbidden' as const,conditions:{batteryTemperatureC:{min:band.min,max:band.max},ambientTemperatureC:{min:-25,max:45},stateOfHealthPercent:{min:70,max:100},
        preconditioning:'unknown' as const,evseMaxPowerKw:null,evseMaxCurrentA:null,evseVoltageRangeV:null,thermalAuxiliariesIncluded:'excluded' as const,conversionLossesIncluded:'excluded' as const},source:method}));
    const profile:VehicleEnergyProfile={id:id+':profile',version,vehicleVariantId:id,supportedConnectors:['ccs2'],acMaxChargePowerKw:d.maxAcChargeKw??11,
      dataQuality:{schemaVersion:'vehicle-quality/1.0.0',policy:'allow_engineering_estimates',quality:'engineering_estimate',verificationNote:evidence.verificationNote,assumptions,methodId:evidence.derivation.methodId,methodVersion:'1.0.0'},
      capacity:{referenceUsableBatteryKwh:capacity,atStateOfHealthPercent:100,source:method},voltageArchitecture:kona?'400v':'800v',nominalPackVoltageV:voltage,
      thermalCapabilities:{heatPump:'unknown',batteryPreconditioning:'unknown'},packVoltageBySoc:null,
      dcChargingPaths:[{id:pathId,mode:'native_pack',inletVoltageRangeV:{min:voltage*.85,max:voltage*1.15},inletVoltageBySoc:null,maxInletPowerKw:peak,maxInletCurrentA:peak*1000/(voltage*.9),conversionEfficiency:.98,source:method}],
      consumptionReferences:refs,dcChargingCurves:curves,energyModel:energy,
      chargingModel:{id:id+':charging',version,vehicleVariantId:id,quality:'engineering_estimate',source:method,verificationNote:evidence.verificationNote,assumptions,
        terminalToStoredEfficiency:.96,auxiliaryPackKw:.5,connectionModel:{batteryKw:1,ambientRangeC:{min:-25,max:45},source:method}},
      physics:{curbMassKg:mass,dragAreaSquareMeters:drag,rollingResistanceCoefficient:rolling,drivetrainEfficiency:efficiency,maxRegenerationKw:75}};
    const configuration={make:d.make,makeSlug:d.makeSlug,model:d.model,modelSlug:d.modelSlug,modelYear:d.modelYear,trim:d.trim,trimSlug:d.trimSlug,variant:d.variant,variantSlug:d.variantSlug,
      vehicleType:d.vehicleType,markets:d.markets,marketedBatteryKwh:d.marketedBatteryKwh??null,usableBatteryKwh:capacity,grossBatteryKwh:d.grossBatteryKwh??d.marketedBatteryKwh??null,
      drivetrain:d.drivetrain??(kona?'fwd':awd||n?'awd':'rwd'),wheelInches:d.wheelInches??null,motorPowerKw:d.motorPowerKw??null,maxAcChargeKw:d.maxAcChargeKw??11,maxDcChargeKw:peak,connectorTypes:['ccs2']};
    summaries.push({entityId:row.entity_id,model:d.model,year:d.modelYear,trim:d.trim,usableKwh:capacity,sourceRecordId:sourceId,consumptionAnchor:average,peakKw:peak,
      consumptionReferences:refs.length,chargingCurves:curves.length,quality:'engineering_estimate'});
    return {externalId:id,matchedEntityId:row.entity_id,matchedLegacyId:null,matchBasis:'Existing canonical Hyundai entity selected explicitly by database UUID; battery/trim/year identity preserved; source matching is a labelled family derivation.',configuration,
      facts:[{id:id+':capacity',field:'usableBatteryKwh',value:capacity,evidence}],
      consumption:refs.map(reference=>({reference,evidence,speedKind:'constant_speed',season:reference.conditions.ambientTemperatureC.min===0?'winter':'summer',seasonBasis:'Modelled temperature scenario, not a measured seasonal test',distanceKm:100,durationSeconds:100/reference.conditions.meanSpeedKph*3600})),
      charging:curves.map(curve=>({curve,evidence})),observations:[],profiles:[{policy:'allow_engineering_estimates',evidence,profile}],
      missing:['Independent variant-specific driving/charging field validation','Measured road-load, inlet-voltage and thermal parameters; values are engineering estimates']};
  });
  const data:KnowledgePackage={schemaVersion:'vehicle-knowledge/1.0.0',source:{key:'chargeroad-hyundai-engineering',name:'ChargeRoad Hyundai engineering baseline',homepageUrl:'https://github.com/KilowattApp/open-ev-data',
    license:method.license!,permission:'own_data',permissionReference:'Own derivations over licensed CDLA/MIT data; upstream attribution and licence included alongside this package.'},
    version,generatedAt:now,retrievedAt:now,coverage:'supplemental',records};
  const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n');parseKnowledgePackage(bytes);
  await mkdir(resolve(root,'data/vehicle-knowledge/hyundai'),{recursive:true});
  await writeFile(resolve(root,'data/vehicle-knowledge/hyundai/engineering-v1.json'),bytes);
  await writeFile(resolve(root,'data/vehicle-knowledge/hyundai/licensed-inputs.json'),JSON.stringify({source:pin,attribution:'Open EV Data (https://github.com/KilowattApp/open-ev-data)',records:[...used.values()]},null,2)+'\n');
  await writeFile(resolve(root,'data/vehicle-knowledge/hyundai/LICENSE-kilowatt.txt'),await readFile(resolve(directory,'kilowatt-LICENSE.txt')));
  if(process.argv.includes('--publish')){const db=new DatabaseService();try{const result=await new VehicleKnowledgeRepository(db).publish(bytes);console.log(JSON.stringify({published:!result.unchanged,records:records.length,batchId:result.batchId}));}finally{await db.onModuleDestroy();}}
  await writeFile(resolve(root,'docs/validation/hyundai-profile-coverage.json'),JSON.stringify({generatedAt:now,method:version,sourceCommit:pin.commit,records:summaries},null,2)+'\n');
  console.log(JSON.stringify({records:records.length,profiles:records.length,speedTemperatureReferences:records.reduce((n,r)=>n+r.consumption.length,0),chargingCurves:records.reduce((n,r)=>n+r.charging.length,0)}));
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Profile generation failed');process.exitCode=1;});
