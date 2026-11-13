import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Linking,Pressable,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import type {VehicleCatalogueDetail,PlanningApiRequest} from '@chargeroad/shared';
import {NavigationPanel} from '../navigation/NavigationPanel';
import type {NavigationRoute,NavigationProgress} from '../navigation/navigation-core';
import {planningApi,PlanningApiError} from '../../api/planning';
import {colors as c} from '../../theme';
import {LocationPicker} from './LocationPicker';
import {ChargeSlider} from './ChargeSlider';
import type {MapState} from '../map/MapCanvas';
import type {RoadPreviewResponse} from '@chargeroad/shared';
import {buildPlanningRequest,initialPlanningForm,LatestPlanningRequest,roadEndpointAdjustment} from './planning-flow';
import type {PlanningForm as Form,PlanningViewResult} from './planning-flow';
const modes=[['minimum_total_duration','En kısa süre'],['minimum_charging_stops','Daha az şarj durağı'],['minimum_energy','Düşük sürüş tüketimi']] as const;
const minutes=(seconds:number)=>`${Math.round(seconds/60)} dk`;
export function PlanningForm({vehicle,active,onRequireVehicle,onMapChange}:{vehicle:VehicleCatalogueDetail|null;active:boolean;onRequireVehicle:()=>void;onMapChange:(state:MapState)=>void}){
  const [form,setForm]=useState<Form>(initialPlanningForm),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<PlanningViewResult|null>(null),[cooldown,setCooldown]=useState(0);
  const runner=useRef(new LatestPlanningRequest()),version=useRef(0),inFlight=useRef(false);
  const [advanced,setAdvanced]=useState(false),[details,setDetails]=useState(false);
  const [jobPhase,setJobPhase]=useState('queued'),[pendingPreview,setPendingPreview]=useState<RoadPreviewResponse|null>(null);
  const [lastRequest,setLastRequest]=useState<PlanningApiRequest|null>(null),[navigationRoute,setNavigationRoute]=useState<NavigationRoute|null>(null),[navigationLocation,setNavigationLocation]=useState<import('@chargeroad/shared').Coordinate|null>(null);
  const [navigationProgress,setNavigationProgress]=useState<NavigationProgress|null>(null);
  function cancel(){version.current++;runner.current.cancel();inFlight.current=false;setBusy(false);}
  function update(patch:Partial<Form>){cancel();setForm(f=>({...f,...patch}));setError('');setResult(null);setPendingPreview(null);}
  useEffect(()=>{update({vehicleId:vehicle?.id??null,allowEstimates:false,allowCatalogueStations:false});},[vehicle?.id]);
  useEffect(()=>{if(!active)cancel();},[active]);
  useEffect(()=>()=>{version.current++;runner.current.cancel();},[]);
  const mapRoute=useMemo(()=>{const planned=result?.result.status==='planned'?result.result.plan:null;
    return {geometry:navigationRoute?navigationRoute.segments.flatMap(s=>s.geometry):planned?planned.roadRoute.segments.flatMap(s=>s.geometry):result?.preview?.route?.geometry??pendingPreview?.route?.geometry??[],
      stops:planned?planned.chargingStops.map((stop,i)=>({id:stop.id,location:stop.location,label:`${i+1}. şarj · %${Math.round(stop.arrivalChargePercent)} → %${Math.round(stop.targetChargePercent)}`,plan:stop})):[]};
  },[result,pendingPreview,navigationRoute]);
  useEffect(()=>{onMapChange({origin:form.origin,destination:form.destination,navigationLocation,navigationProgress,navigationAttributions:navigationRoute?.attributions,...mapRoute});
  },[form.origin,form.destination,mapRoute,onMapChange,navigationLocation,navigationProgress,navigationRoute]);
  useEffect(()=>{if(cooldown<=0)return;const timer=setInterval(()=>setCooldown(v=>Math.max(0,v-1)),1000);return()=>clearInterval(timer);},[cooldown>0]);
  async function submit(allowApproximate=false,locations?:Pick<Form,'origin'|'destination'>,allowCatalogue=false){if(inFlight.current||cooldown>0)return;
    if(!vehicle){onRequireVehicle();return;}
    if(!form.allowEstimates&&!allowApproximate&&vehicle.make.toLowerCase()==='hyundai'){
      Alert.alert('Kaynaklı yaklaşık hesap','Yaklaşık araç modeli ve istasyonların katalogdaki DC soket türü/gücüyle koşullu bir plan oluşturabiliriz. İstasyon voltajı, sürekli güç ve canlı müsaitlik doğrulanmış değildir; süreler garanti edilmez. Operatör hesabı gerekebilir.',
        [{text:'Vazgeç',style:'cancel'},{text:'Onayla ve planla',onPress:()=>{update({allowEstimates:true,allowCatalogueStations:true});void submit(true,undefined,true);}}]);return;}
    setError('');setResult(null);let request;
    try{request=buildPlanningRequest({...form,...locations,allowEstimates:allowApproximate||form.allowEstimates,allowCatalogueStations:allowCatalogue||form.allowCatalogueStations,vehicleId:vehicle.id},Crypto.randomUUID());}catch(cause){setError(cause instanceof Error?cause.message:'Bilgileri kontrol et.');return;}
    if(__DEV__){const origin=(locations?.origin??form.origin),accuracy=origin?.id==='device-location'?/±(\d+) m/.exec(origin.label)?.[1]:undefined;
      console.info('planning_started',{requestId:request.requestId,originSource:origin?.id==='device-location'?'device':origin?.id.startsWith('road-point:')?'confirmed_road_point':'address_search',reportedAccuracyMeters:accuracy?Number(accuracy):null});}
    const current=++version.current;inFlight.current=true;setBusy(true);
    const secret=(Crypto.randomUUID()+Crypto.randomUUID()).replaceAll('-','');
    const ports={...planningApi,plan:(r:typeof request,s:AbortSignal)=>planningApi.planAsync(r,s,secret,
      phase=>{if(version.current===current)setJobPhase(phase);},preview=>{if(version.current===current)setPendingPreview(preview);})};
    try{await runner.current.run(request,ports,next=>{if(__DEV__)console.info('planning_result',{requestId:request.requestId,status:next.result.status,reasons:next.result.status==='planned'?[]:next.result.reasons.map(r=>r.code)});
      setResult(next);setLastRequest(request);setCooldown(Math.max(next.previewRetryAfterSeconds??0,next.result.metadata?.retryAfterSeconds??0,next.result.status==='provider_error'||next.result.status==='computation_limit'?1:0));});}
    catch(cause){if(version.current===current){if(__DEV__)console.info('planning_failed',{requestId:request.requestId,httpStatus:cause instanceof PlanningApiError?cause.status:null});setError(cause instanceof Error?cause.message:'Plan alınamadı.');if(cause instanceof PlanningApiError)setCooldown(cause.retryAfterSeconds);}}
    finally{if(version.current===current){inFlight.current=false;setBusy(false);}}}
  const output=result?.result;
  const adjustment=roadEndpointAdjustment(form,result);
  function confirmRoadPoints(){if(!adjustment||!result?.preview?.route)return;const generation=version.current,road=result.preview.route;
    Alert.alert('Aracının yol noktasını onayla',`Seçilen konumdan başlangıç yoluna ${Math.ceil(road.originSnapMeters)} m, varış yoluna ${Math.ceil(road.destinationSnapMeters)} m eşleme var. Araç yolculuğunu haritadaki bu noktalardan hesaplayalım mı? Aradaki erişim sürüş hesabına dahil değildir.`,
      [{text:'Adresi değiştireceğim',style:'cancel'},{text:'Onayla ve hesapla',onPress:()=>{if(version.current!==generation)return;update(adjustment);void submit(form.allowEstimates,adjustment,form.allowCatalogueStations);}}]);}
  return <View style={s.container}>
    <NavigationPanel plan={output?.status==='planned'?output.plan:null} request={lastRequest} onLocation={setNavigationLocation} onRoute={setNavigationRoute} onProgress={setNavigationProgress}
      onPlan={(result,request)=>{setResult({result,preview:null,previewError:null});setLastRequest(request);}}/>
    <LocationPicker label="BAŞLANGIÇ" value={form.origin} onChange={origin=>update({origin})} deviceLocation/>
    <LocationPicker label="VARIŞ" value={form.destination} onChange={destination=>update({destination})}/>
    <Pressable testID="route-vehicle-selector" accessibilityRole="button" accessibilityLabel="Seçili aracı değiştir" onPress={onRequireVehicle} style={s.vehicle}>
      <Text style={s.vehicleIcon}>↗</Text><View style={{flex:1}}><Text style={s.title}>{vehicle?`${vehicle.make} ${vehicle.model}`:'Bir yol arkadaşı seç'}</Text><Text style={s.small}>{vehicle?`${vehicle.modelYear} · ${vehicle.trim}`:'Yalnız rota planlarken gerekli'}</Text></View><Text style={s.link}>{vehicle?'Değiştir':'Seç'}</Text>
    </Pressable>
    <View style={s.card}>
      <Text style={s.title}>Şarj tercihlerin</Text>
      {([['startingCharge','Başlangıç şarjı','Yola çıkarken'],['reserve','Minimum yol rezervi','Yolda korumak istediğin'],['arrival','Hedef varış şarjı','Varışta kalmasını istediğin']] as const).map(([key,label,hint])=>
        <ChargeSlider key={key} label={label} value={form[key]} hint={hint} onChange={value=>update({[key]:value})}/>)}
      <Text style={s.small}>Rezerv, yol boyunca korumak istediğin alt sınırdır. Hedef varış şarjı bu değerden düşük olamaz.</Text>
    </View>
    <View style={s.card}><Text style={s.title}>Önceliğin</Text>
      {modes.map(([key,label])=><Pressable key={key} accessibilityRole="radio" accessibilityState={{checked:form.objective===key}} onPress={()=>update({objective:key})} style={[s.choice,form.objective===key&&s.chosen]}>
        <Text style={s.text}>{form.objective===key?'●':'○'} {label}</Text></Pressable>)}
      <Text style={s.small}>Az durak seçimi %80 üzerinde şarj önerebilir. Düşük tüketim modu net sürüş batarya enerjisini azaltmayı hedefler.</Text>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Diğer rota ayarları" onPress={()=>setAdvanced(v=>!v)} style={s.settings}><Text style={s.text}>Zaman ve yol tercihleri</Text><Text style={s.text}>{advanced?'−':'+'}</Text></Pressable>
    {advanced&&<><View style={s.card}><Text style={s.title}>Hareket zamanı</Text>
      <View style={s.row}>{(['now','scheduled'] as const).map(key=><Pressable key={key} accessibilityRole="radio" accessibilityState={{checked:form.departure===key}}
        onPress={()=>update({departure:key})} style={[s.choice,form.departure===key&&s.chosen]}><Text style={s.text}>{key==='now'?'Şimdi':'Tarih seç'}</Text></Pressable>)}</View>
      {form.departure==='scheduled'&&<><Text style={s.small}>Telefonun yerel saati · YYYY-AA-GG SS:DD</Text><TextInput accessibilityLabel="Hareket tarihi ve saati" value={form.scheduled}
        onChangeText={scheduled=>update({scheduled})} placeholder="2026-11-13 09:30" placeholderTextColor={c.muted} maxLength={16} style={s.date}/></>}
      <Text style={s.small}>72 saatten sonrası için yalnız yol önizlemesi sunulur. “Şimdi” seçimi hesaplama ve hazırlık payı içerir; plan hazır olduğunda hareket saati gösterilir.</Text>
    </View>
    <View style={s.card}>
      <View style={s.row}><Text style={s.text}>Ücretli yollardan kaçın</Text><Switch value={form.avoidTolls} onValueChange={avoidTolls=>update({avoidTolls})}/></View>
      <View style={s.row}><Text style={s.text}>Feribotlardan kaçın</Text><Switch value={form.avoidFerries} onValueChange={avoidFerries=>update({avoidFerries})}/></View>
      <View style={s.row}><Text style={[s.text,{flex:1}]}>Yaklaşık profille hesaplamaya izin ver</Text><Switch accessibilityLabel="Mühendislik tahmini profiline açık onay" value={form.allowEstimates} onValueChange={allowEstimates=>update({allowEstimates})}/></View>
      <Text style={s.small}>Yalnız mevcut, kaynakları ve sürümü kayıtlı mühendislik profilleri kullanılabilir. Sonuçlar tahminidir; eksik profil bu seçimle oluşturulmaz.</Text>
    </View></>}
    <View style={s.row}><View style={{flex:1}}><Text style={s.text}>Katalog gücüyle yaklaşık şarj planı</Text><Text style={s.small}>Voltaj ve sürekli güç teyidi gerekir; süreler koşulludur.</Text></View>
      <Switch value={!!form.allowCatalogueStations} onValueChange={allowCatalogueStations=>update({allowCatalogueStations})}/></View>
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Pressable testID="plan-route-button" accessibilityRole="button" accessibilityLabel="Planla" accessibilityState={{disabled:busy||cooldown>0}} disabled={busy||cooldown>0} onPress={()=>void submit()} style={[s.primary,(busy||cooldown>0)&&s.disabled]}>
      <Text style={s.primaryText}>{cooldown>0?`${cooldown} sn sonra tekrar dene`:busy?(jobPhase==='queued'?'Planın hesaplama sırasında…':'Enerji ve şarj planın hesaplanıyor…'):vehicle?'Rotamı planla':'Araç seç ve planla'}</Text></Pressable>
    {busy&&pendingPreview?.route&&<View style={s.card}><Text style={s.title}>Yol önizlemen hazır</Text><Text style={s.text}>{(pendingPreview.route.distanceMeters/1000).toFixed(1)} km · {minutes(pendingPreview.route.drivingDurationSeconds)}</Text>
      {pendingPreview.route.attributions.map(a=><Pressable key={a.url} accessibilityRole="link" onPress={()=>void Linking.openURL(a.url)}><Text style={s.small}>{a.text}</Text></Pressable>)}
      <Text style={s.small}>Şarj durakları ve enerji hesabı sürüyor. İşlemi iptal edebilirsin.</Text></View>}
    {busy&&<View style={s.row}><ActivityIndicator color={c.green}/><Pressable accessibilityRole="button" onPress={cancel}><Text style={s.link}>İptal et</Text></Pressable></View>}
    {output&&<View style={s.card} accessibilityLiveRegion="polite">
      {output.status==='planned'?<>
        <Text style={s.title}>Planın hazır</Text>
        {output.metadata.requestedDepartureAt&&output.plan.scenario&&<Text style={s.small}>Hesaplanan hareket: {new Date(output.plan.scenario.departureAt).toLocaleTimeString('tr-TR')}</Text>}
        <Text style={s.text}>{(output.plan.roadRoute.distanceMeters/1000).toFixed(1)} km · Varış şarjı %{output.plan.estimatedArrivalChargePercent.toFixed(1)}</Text>
        <Text style={s.text}>{output.plan.chargingStops.length} şarj durağı · Sürüş {minutes(output.plan.duration.drivingSeconds)} · Şarj {minutes(output.plan.duration.chargingSeconds)}</Text>
        <Text style={s.small}>Bağlantı/hazırlık {minutes(output.plan.duration.connectionSeconds+output.plan.duration.blockingPreconditioningSeconds)}. {output.plan.estimatedArrivalAt?`Tahmini varış: ${new Date(output.plan.estimatedArrivalAt).toLocaleString('tr-TR')}`:'Gerçek bekleme ve kesin varış saati belirsiz; süreler koşullu senaryodur.'}</Text>
        <Pressable accessibilityRole="button" onPress={()=>setDetails(v=>!v)}><Text style={s.link}>{details?'Ayrıntıları gizle':'Tahmin ayrıntıları ve varsayımlar'}</Text></Pressable>
        {details&&output.plan.assumptions.map(a=><Text key={a.id} style={s.small}>{a.explanation}</Text>)}
        {details&&output.plan.warnings.map((w,i)=><Text key={i} style={s.notice}>{w.explanation}</Text>)}
        {form.allowEstimates&&<Text style={s.notice}>Mühendislik tahmini kullanımına izin verdin. Bu plan saha doğruluğu garantisi değildir.</Text>}
        {output.plan.chargingStops.some(s=>s.hardwareBasis==='catalogue_power_scenario')&&<Text style={s.notice}>Şarj süreleri katalog gücüne dayalı koşullu senaryodur. İstasyon voltaj uyumunu ve gücünü operatörden teyit et.</Text>}
        {output.plan.roadRoute.metadata?.attributions.map(a=><Pressable accessibilityRole="link" key={a.url} onPress={()=>void Linking.openURL(a.url)}><Text style={s.small}>{a.text}</Text></Pressable>)}
      </>:<>
        <Text style={s.title}>{output.status==='insufficient_data'?'Yol önizlemen':output.status==='infeasible'?'Tercihlerini birlikte güncelleyelim':output.status==='provider_error'?'Rotan şu anda hazırlanamadı':'Rota hesabı henüz tamamlanamadı'}</Text>
        {output.reasons.map((r,i)=><Text key={i} style={s.text}>{r.explanation}</Text>)}
        {output.status==='insufficient_data'&&<Text style={s.notice}>Varış şarjı ve otomatik şarj durağı önerisi sunulamıyor. Bu sonuç yolculuğun yapılamayacağı anlamına gelmez.</Text>}
      </>}
      {result.preview?.route&&<View style={s.preview}><Text style={s.title}>Yol önizlemesi</Text><Text style={s.text}>{(result.preview.route.distanceMeters/1000).toFixed(1)} km · Sürüş {minutes(result.preview.route.drivingDurationSeconds)}</Text>
        <Text style={s.small}>Seçilen konumdan yol noktasına eşleme: başlangıç {Math.ceil(result.preview.route.originSnapMeters)} m, varış {Math.ceil(result.preview.route.destinationSnapMeters)} m. Bu erişim mesafelerinin süreleri dahil değildir.</Text>
        <Text style={s.small}>{result.preview.route.traffic==='live'?'Canlı trafik içerir.':'Süre canlı trafik içermez.'} Şarj ve bekleme süreleri dahil değildir.</Text>
        {result.preview.route.warnings.length>0&&<Text style={s.notice}>Yol verilerinde eksikler veya belirsizlikler var; süre ve yol bilgileri yaklaşık olabilir.</Text>}
        {result.preview.route.attributions.map(a=><Pressable accessibilityRole="link" key={a.url} onPress={()=>void Linking.openURL(a.url)}><Text style={s.small}>{a.text}</Text></Pressable>)}
      </View>}
      {result.preview?.status==='not_found'&&<Text style={s.notice}>Bu konumlar arasında yol önizlemesi bulunamadı.</Text>}
      {adjustment&&<Pressable testID="confirm-road-endpoints" accessibilityRole="button" onPress={confirmRoadPoints} style={s.primary}><Text style={s.primaryText}>Yol noktalarını onayla ve hesapla</Text></Pressable>}
      {!!result.previewError&&<Text style={s.notice}>{result.previewError}</Text>}
    </View>}
    <Text style={s.small}>Araç seçimin bu cihazda saklanır. Bu akış seyahat geçmişi veya hesap garajı oluşturmaz.</Text>
  </View>;
}
const s=StyleSheet.create({container:{gap:12,marginTop:0},heading:{color:c.ink,fontSize:20,fontWeight:'800'},card:{padding:16,borderRadius:20,backgroundColor:c.surface,borderWidth:1,borderColor:c.line,gap:17},
  vehicle:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderRadius:18,backgroundColor:'#E7EEE5'},vehicleIcon:{color:c.green,fontSize:25},settings:{padding:15,flexDirection:'row',justifyContent:'space-between'},
  title:{color:c.ink,fontSize:16,fontWeight:'700'},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},text:{color:c.ink,fontSize:13,lineHeight:20},
  small:{color:c.muted,fontSize:11,lineHeight:18},notice:{color:c.green,fontSize:12,lineHeight:19},error:{color:c.error,fontSize:12,lineHeight:19},
  percent:{flexDirection:'row',alignItems:'center',gap:4,backgroundColor:c.softGreen,paddingHorizontal:8,borderRadius:10},number:{minWidth:50,color:c.ink,fontSize:18,paddingVertical:8,textAlign:'center'},
  choice:{padding:11,borderWidth:1,borderColor:c.line,borderRadius:12},chosen:{backgroundColor:c.softGreen,borderColor:c.green},date:{color:c.ink,fontSize:15,padding:12,borderWidth:1,borderColor:c.line,borderRadius:12},
  primary:{backgroundColor:c.ink,padding:17,borderRadius:15,alignItems:'center'},primaryText:{color:c.lime,fontSize:14,fontWeight:'700'},disabled:{opacity:0.5},link:{color:c.green,padding:12},preview:{gap:8,borderTopWidth:1,borderColor:c.line,paddingTop:14}});
