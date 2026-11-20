import {useEffect,useRef,useState} from 'react';
import {AppState,Linking,Pressable,StyleSheet,Text,View} from 'react-native';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {Coordinate,PlanningApiRequest} from '@chargeroad/shared';
import type {ClientPlanningResponse as PlanningApiResponse,ClientRoutePlan as RoutePlan} from '../../api/plan-view';
import {planningApi,PlanningApiError} from '../../api/planning';
import {ChargeSlider} from '../planning/ChargeSlider';
import {colors as c} from '../../theme';
import {compactNavigationRoute,locateOnRoute,navigationProgress,replanFromNavigation,trackDeviation,validFix} from './navigation-core';
import type {DeviationState} from './navigation-core';
import type {GpsFix,NavigationRoute,NavigationProgress} from './navigation-core';
import {decodeTrip,TRIP_STORAGE_KEY} from './trip-storage';
import {devLog} from '../../dev/dev-log';
import {accumulateBaseline,appendJournal,readJournal,SOC_FEEDBACK_POLICY,socCorrection,startBaseline,summarizeJournal} from './soc-feedback';
import Ionicons from '@expo/vector-icons/Ionicons';
import {formatDistance,formatDuration,stopTimeline} from './navigation-view';
import type {TripSnapshot} from './trip-storage';

export function NavigationPanel({plan,request,vehicleLabel,startRef,onPlan,onLocation,onRoute,onProgress,onTrip,onBack}:{plan:RoutePlan|null;request:PlanningApiRequest|null;
 /** Trip card shortcut: set to start() while a new plan can start without a resumed trip (form SOC is the user's own entry). */
 startRef?:{current:(()=>void)|null};
 onBack?:()=>void;vehicleLabel?:string;
 /** correctSoc: the navigation SOC chip; returns an error message or null when the correction was applied. */
 onTrip?:(trip:{active:boolean;confirmedStopId:string|null;end:()=>void;correctSoc:(percent:number)=>string|null}|null)=>void;
 onPlan:(result:PlanningApiResponse,request:PlanningApiRequest)=>void;onLocation:(p:Coordinate|null)=>void;onRoute:(r:NavigationRoute|null)=>void;onProgress:(p:NavigationProgress|null)=>void}){
 const [trip,setTrip]=useState<TripSnapshot|null>(null),[charge,setCharge]=useState(''),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const [gpsFresh,setGpsFresh]=useState(false);
 const current=useRef<TripSnapshot|null>(null),fixRef=useRef<GpsFix|null>(null),firstFix=useRef(true),lastWrite=useRef(0),queue=useRef(Promise.resolve()),alive=useRef(true);
 const pending=useRef<AbortController|null>(null),generation=useRef(0),deviation=useRef<DeviationState|null>(null),nextReplanAt=useRef(0),replanned=useRef(false);
 const onPlanRef=useRef(onPlan);onPlanRef.current=onPlan;const feedbackQueue=useRef(Promise.resolve());
 // Navigation step 1: the full-screen mode follows the tracked trip (active even while GPS is stale), not the GPS freshness.
 const onTripRef=useRef(onTrip);onTripRef.current=onTrip;
 useEffect(()=>{onTripRef.current?.(trip?{active:trip.status==='active',confirmedStopId:trip.anchor.stopId,end:()=>stopRef.current(),correctSoc:(percent:number)=>correctRef.current(percent)}:null);},[trip?.status,trip?.anchor.stopId,!!trip]);
 useEffect(()=>{onProgress(trip?.status==='active'&&gpsFresh?trip.progress:null);if(trip?.status!=='active')onLocation(null);},[trip?.progress,trip?.status,gpsFresh,onProgress,onLocation]);
 useEffect(()=>{if(trip?.status!=='active'){setGpsFresh(false);return;}const timer=setInterval(()=>setGpsFresh(!!fixRef.current&&validFix(fixRef.current,Date.now())),3000);return()=>clearInterval(timer);},[trip?.status]);
 function persist(next:TripSnapshot|null){queue.current=queue.current.catch(()=>{}).then(async()=>{if(next){const raw=JSON.stringify({...next,progress:null});
   if(raw.length>750000){if(alive.current)setMessage('Bu uzun rota cihazda devam ettirmek için saklanamadı; uygulama açıkken takip sürebilir.');return;}
   await AsyncStorage.setItem(TRIP_STORAGE_KEY,raw);}else await AsyncStorage.removeItem(TRIP_STORAGE_KEY);}).catch(()=>{if(alive.current)setMessage('Yolculuk bu cihazda saklanamadı.');});}
 function publish(next:TripSnapshot|null,save=false){current.current=next;setTrip(next);if(save)persist(next);}
 useEffect(()=>{alive.current=true;void AsyncStorage.getItem(TRIP_STORAGE_KEY).then(raw=>{if(!alive.current)return;
   const saved=raw?decodeTrip(raw,Date.now()):null;if(saved){publish(saved);onRoute(saved.route);setMessage('Yarım kalan yolculuk bulundu. Güncel şarjını doğrulayarak devam edebilirsin.');}
   else if(raw)persist(null);setLoaded(true);},()=>{if(alive.current){setLoaded(true);setMessage('Kayıtlı yolculuk okunamadı.');}});
  return()=>{alive.current=false;generation.current++;pending.current?.abort();};},[]);
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{const active=state==='active';setForeground(active);
  if(!active){generation.current++;pending.current?.abort();pending.current=null;setBusy(false);const t=current.current;if(t?.status==='active')publish({...t,status:'paused',updatedAt:Date.now()},true);}});return()=>sub.remove();},[]);
 async function replan(observedSoc?:number){const t=current.current,fix=fixRef.current;if(!t||!fix||!t.progress)return;
  if(Date.now()<nextReplanAt.current){setMessage('Yeniden hesaplama için servis bekleme süresinin dolması gerekiyor.');return;}
  pending.current?.abort();const controller=new AbortController(),version=++generation.current;pending.current=controller;setBusy(true);
  const replanStart=Date.now();devLog('nav_replan_start',{observedSoc:observedSoc??null,estimatedSoc:t.progress.soc,remainingKm:t.progress.remainingMeters/1000});
  try{const updated=replanFromNavigation(t.request,t.route,fix,t.progress,Crypto.randomUUID(),Date.now(),observedSoc);
   setMessage(observedSoc===undefined?'Tahmini şarjla rota yenileniyor; araç göstergesini kontrol et.':'Güncel şarjınla rota yenileniyor.');
   const result=await planningApi.planAsync(updated,controller.signal,(Crypto.randomUUID()+Crypto.randomUUID()).replaceAll('-',''),()=>{});
   if(!alive.current||version!==generation.current)return;
   if(result.status==='planned'){const route=compactNavigationRoute(result.plan),next={...current.current!,request:updated,route,
     anchor:{distance:0,percent:updated.startingChargePercent,observedAt:Date.parse(updated.startingChargeObservedAt),stopId:null},progress:null,updatedAt:Date.now()};
    devLog('nav_replan_done',{ms:Date.now()-replanStart,status:'planned',stops:route.stops.length});
    firstFix.current=false;deviation.current=null;replanned.current=true;publish(next,true);onRoute(route);onPlanRef.current(result,updated);setMessage('Rota güncellendi. Şarj yüzdesi tahminidir.');
   }else {devLog('nav_replan_done',{ms:Date.now()-replanStart,status:result.status,reason:result.reasons[0]?.code??null});nextReplanAt.current=Date.now()+Math.max(60,result.metadata.retryAfterSeconds??0)*1000;setMessage(result.reasons.map(r=>r.explanation).join(' '));}
  }catch(error){if(version===generation.current&&!controller.signal.aborted){if(error instanceof PlanningApiError)nextReplanAt.current=Date.now()+Math.max(60,error.retryAfterSeconds)*1000;setMessage(error instanceof Error?error.message:'Rota yenilenemedi.');}}
  finally{if(version===generation.current){pending.current=null;setBusy(false);nextReplanAt.current=Math.max(nextReplanAt.current,Date.now()+(replanned.current?20000:60000));replanned.current=false;}}
 }
 useEffect(()=>{if(!foreground||trip?.status!=='active')return;let disposed=false,subscription:Location.LocationSubscription|undefined;
  const receive=(location:Location.LocationObject)=>{if(disposed)return;const t=current.current;if(!t||t.status!=='active')return;
   const now=Date.now(),fix:GpsFix={latitude:location.coords.latitude,longitude:location.coords.longitude,timestamp:location.timestamp,accuracy:location.coords.accuracy,speed:location.coords.speed,heading:location.coords.heading};
   if(!validFix(fix,now)){setMessage('Kesin ve güncel GPS konumu bekleniyor; son tahmin korunuyor.');return;}
   const old=fixRef.current;fixRef.current=fix;setGpsFresh(true);onLocation(fix);
   let anchor=t.anchor,initialReplan=false;if(firstFix.current){
    if(now-anchor.observedAt>60000){publish({...t,status:'paused'},true);setMessage('GPS beklenirken şarj doğrulaması eskidi; güncel yüzdeden devam et.');return;}
    const position=locateOnRoute(t.route,fix);if(position&&position.crossTrackMeters<=100)anchor={...anchor,distance:position.distance};
    initialReplan=!!position&&(position.distance>100||position.crossTrackMeters>50||Math.abs(anchor.percent-t.route.segments[0].startSoc)>1);firstFix.current=false;}
   const progress=navigationProgress(t.route,fix,now,anchor,old&&t.progress?{distance:t.progress.distance,timestamp:old.timestamp}:undefined);if(!progress)return;
   // SOC feedback: metres since the last user-entered SOC (same route only; a replan starts from progress null).
   const feedback=t.progress&&old?accumulateBaseline(t.feedback,t.route,t.progress.distance,progress.distance):t.feedback;
   publish({...t,anchor,progress,feedback,updatedAt:now});
   if(initialReplan&&!pending.current)void replan(anchor.percent);
   if(now-lastWrite.current>=15000){lastWrite.current=now;persist(current.current);}
   const [state,due]=trackDeviation(deviation.current,progress,fix,now);
   if(state&&!deviation.current)devLog('nav_deviation_start',{wrongWay:!!progress.wrongWay,offRoute:progress.offRoute,crossTrackM:progress.crossTrackMeters,accuracyM:fix.accuracy,speedKph:fix.speed!=null?fix.speed*3.6:null});
   if(due&&!pending.current)devLog('nav_replan_trigger',{wrongWay:!!progress.wrongWay,fixes:state?.fixes??0,sinceMs:state?now-state.since:0,cooldownMs:Math.max(0,nextReplanAt.current-now)});
   deviation.current=state;
   if(state){setMessage(progress.wrongWay?'Rotanın ters yönündesin; rota yenileniyor.':'Rotadan çıktın; rota yenileniyor.');
    if(due&&!pending.current&&now>=nextReplanAt.current)void replan();}
  };
  void Location.requestForegroundPermissionsAsync().then(async permission=>{if(disposed)return;if(permission.status!=='granted'){setMessage('Navigasyon için konum izni gerekiyor.');const t=current.current;if(t)publish({...t,status:'paused'},true);return;}
   const watch=await Location.watchPositionAsync({accuracy:Location.Accuracy.High,timeInterval:2000,distanceInterval:10},receive);if(disposed)watch.remove();else subscription=watch;
  }).catch(()=>{if(!disposed){setMessage('GPS takibi başlatılamadı.');const t=current.current;if(t)publish({...t,status:'paused'},true);}});
  return()=>{disposed=true;subscription?.remove();};
 },[trip?.status,foreground]);
 function start(){const base=current.current;if(!base&&(!plan||!request))return;const value=Number(charge||request?.startingChargePercent);
  if(!Number.isFinite(value)||value<0||value>100||base&&charge===''){setMessage('Araç göstergesindeki güncel şarj yüzdesini doğrula.');return;}
  const now=Date.now(),route=base?.route??compactNavigationRoute(plan!),source=base?.request??request!,next:TripSnapshot={version:1,id:base?.id??Crypto.randomUUID(),status:'active',updatedAt:now,
   route,request:source,anchor:{distance:base?.anchor.distance??0,percent:value,observedAt:now,stopId:null},progress:null,
   feedback:startBaseline(value,now,'start'),vehicleLabel:base?.vehicleLabel??vehicleLabel,
   events:[...(base?.events??[]),{id:Crypto.randomUUID(),sequence:(base?.events.at(-1)?.sequence??0)+1,at:now,planId:route.planId,percent:value,predictedPercent:base?.anchor.percent??source.startingChargePercent,reason:'start' as const}].slice(-128)};
  fixRef.current=null;firstFix.current=true;nextReplanAt.current=0;publish(next,true);onRoute(route);setCharge('');setMessage('GPS bekleniyor. Bu takip yalnız uygulama ön plandayken çalışır.');
 }
 function correct(afterCharging=false){if(charge===''){setMessage('Güncel GPS ve araç göstergesindeki şarj yüzdesi gerekiyor.');return;}
  const error=applyCorrection(Number(charge),afterCharging);if(error)setMessage(error);}
 const correctRef=useRef<(percent:number)=>string|null>(()=>null);
 // The SOC chip counts as the after-charging confirmation while the car is at a planned stop.
 correctRef.current=percent=>applyCorrection(percent,!!current.current?.progress?.needsChargeConfirmation);
 function applyCorrection(value:number,afterCharging:boolean):string|null{const t=current.current,fix=fixRef.current;
  if(!t?.progress||!fix||!validFix(fix,Date.now()))return 'Güncel GPS ve araç göstergesindeki şarj yüzdesi gerekiyor.';
  if(!Number.isFinite(value)||value<0||value>100)return 'Şarj yüzdesi 0–100 arasında olmalı.';
  const stop=afterCharging?t.route.stops.find(s=>Math.abs(s.distance-t.progress!.distance)<=150):undefined,now=Date.now();
  if(afterCharging&&!stop)return 'Şarj sonrası doğrulama için planlanan durağa yakın konum gerekiyor. Diğer konumlarda şarj düzeltmesini kullan.';
  recordFeedback(t,value,stop?'after_charging':'correction',now);
  const next={...t,updatedAt:now,feedback:startBaseline(value,now,stop?'after_charging':'correction'),anchor:{distance:t.progress.distance,percent:value,observedAt:now,stopId:stop?.id??null},events:[...t.events,
    {id:Crypto.randomUUID(),sequence:(t.events.at(-1)?.sequence??0)+1,at:now,planId:t.route.planId,percent:value,predictedPercent:t.progress.soc,reason:stop?'after_charging' as const:'correction' as const}].slice(-128)};
  publish(next,true);setCharge('');void replan(value);return null;
 }
 /** SOC feedback journal: on this device only (no upload, no automatic learning) plus development logs. */
 function recordFeedback(t:TripSnapshot,observed:number,reason:'correction'|'after_charging',now:number){
  const record=socCorrection({vehicleVariantId:t.request.vehicleVariantId,vehicleLabel:t.vehicleLabel,route:t.route,baseline:t.feedback,predicted:t.progress!.soc,observed,at:now,reason});
  devLog('soc_correction',record);
  feedbackQueue.current=feedbackQueue.current.catch(()=>{}).then(async()=>{const raw=appendJournal(await AsyncStorage.getItem(SOC_FEEDBACK_POLICY.journalKey),record);
   await AsyncStorage.setItem(SOC_FEEDBACK_POLICY.journalKey,raw);
   for(const summary of summarizeJournal(readJournal(raw)))if(summary.vehicleVariantId===record.vehicleVariantId&&summary.energyModel===record.energyModel)devLog('soc_feedback_summary',summary);
  }).catch(()=>{});
 }
 const stopRef=useRef<()=>void>(()=>{});stopRef.current=()=>stop();
 if(startRef)startRef.current=loaded&&!trip&&plan&&request?start:null;
 function stop(){generation.current++;pending.current?.abort();pending.current=null;setBusy(false);publish(null,true);onRoute(null);onLocation(null);fixRef.current=null;setMessage('Yolculuk takibi kapatıldı.');}
 if(!loaded||!plan&&!trip)return null;const p=trip?.progress;
 const active=trip?.status==='active',timeline=trip?stopTimeline(trip.route,{distance:p?.distance??trip.anchor.distance},trip.anchor.stopId):[];
 // Navigation step 1b: while navigating this panel is the sheet (stops, charge check, end trip); before it, a single start card.
 if(!active||!trip)return <View style={styles.hero}>
  <View style={styles.heroTop}>
   {!trip&&onBack&&<Pressable testID="plan-back" accessibilityRole="button" accessibilityLabel="Plandan çık ve yeni rota oluştur" onPress={onBack} hitSlop={10} style={styles.back}>
    <Ionicons name="arrow-back" size={18} color={c.lime}/><Text style={styles.backText}>Yeni rota</Text></Pressable>}
   <Text style={styles.eyebrow}>{trip?'YARIM KALAN YOLCULUK':'YOLA ÇIKMAYA HAZIR'}</Text></View>
  <Text style={styles.heroTitle}>{trip?'Kaldığın yerden devam et':'Navigasyonu başlat'}</Text>
  {trip&&plan&&plan.planId!==trip.route.planId&&<Text style={styles.heroNote}>Yeni planı başlatmak için önce yarım kalan yolculuğu bitir.</Text>}
  <View style={styles.heroSlider}><ChargeSlider label="Araç göstergesindeki şarj" hint="Başlamadan doğrula" value={charge||(!trip?String(request?.startingChargePercent??''):'')} onChange={setCharge}/></View>
  <Text style={styles.heroNote}>Şarj tahminleri bu değerden başlar; planlanan şarjlar sen doğrulamadan gerçekleşmiş sayılmaz.</Text>
  <Pressable testID="navigation-start" accessibilityRole="button" onPress={start} style={styles.primary}><Ionicons name="navigate" size={18} color={c.ink}/><Text style={styles.primaryText}>{trip?'Yolculuğa devam et':'Navigasyonu başlat'}</Text></Pressable>
  {trip&&<Pressable accessibilityRole="button" onPress={stop}><Text style={styles.heroLink}>Yarım kalan yolculuğu bitir</Text></Pressable>}
  {!!message&&<Text accessibilityLiveRegion="polite" style={styles.heroNote}>{message}</Text>}
 </View>;
 return <View style={{gap:12}}>
  {p?.needsChargeConfirmation&&<View style={[styles.card,styles.alert]}>
   <Text style={styles.title}>Şarj durağındasın</Text>
   <Text style={styles.text}>Şarj bitince göstergedeki gerçek yüzdeyi gir; kalan yolculuk bu değerden yeniden planlanır.</Text>
   <ChargeSlider label="Göstergedeki şarj" hint="Şarj sonrası" value={charge} onChange={setCharge}/>
   <Pressable disabled={busy} accessibilityRole="button" onPress={()=>correct(true)} style={styles.primary}><Text style={styles.primaryText}>Şarjım bitti · devam et</Text></Pressable>
  </View>}
  <View style={styles.card}>
   <Text style={styles.title}>Şarj durakları</Text>
   {!timeline.length&&<Text style={styles.text}>Bu yolculukta şarj molası yok.</Text>}
   {timeline.map(item=><View key={item.id} style={styles.stopRow}>
    <View style={[styles.stopDot,item.status==='passed'&&styles.stopPassed,item.status==='next'&&styles.stopNext]}>
     {item.status==='passed'?<Ionicons name="checkmark" size={14} color="white"/>:<Text style={styles.stopIndex}>{item.index}</Text>}</View>
    <View style={{flex:1}}><Text style={[styles.stopTitle,item.status==='passed'&&{color:c.muted}]}>{item.index}. şarj · {item.status==='passed'?'geçildi':formatDistance(Math.max(0,item.distance))+' sonra'}</Text>
     <Text style={styles.stopMeta}>Plan: varış %{Math.round(item.plannedArrivalSoc)} → %{Math.round(item.targetSoc)}{item.seconds?' · ~'+formatDuration(item.seconds):''}</Text></View>
   </View>)}
   <View style={styles.stopRow}><View style={[styles.stopDot,styles.stopFinish]}><Ionicons name="flag" size={13} color="white"/></View>
    <Text style={styles.stopTitle}>Varış · {p?formatDistance(p.remainingMeters):'—'} · hedef %{trip.route.arrivalTarget}</Text></View>
  </View>
  <View style={styles.card}>
   <Text style={styles.title}>Şarj durumu</Text>
   <Text style={styles.text}>{p?'Tahmini şarj %'+p.soc.toFixed(1)+(gpsFresh?'':' · son tahmin'):'GPS konumu bekleniyor…'}</Text>
   {p&&p.soc<trip.route.reserve&&<Text style={styles.warning}>Tahmini şarj seçtiğin rezervin altında. Güvenli bir yerde durup araç göstergesini kontrol et.</Text>}
   <ChargeSlider label="Göstergedeki şarj" hint="Tahmin farklıysa düzelt" value={charge} onChange={setCharge}/>
   <Pressable disabled={busy} accessibilityRole="button" onPress={()=>correct(false)} style={styles.secondary}><Text style={styles.secondaryText}>Şarjı düzelt ve rotayı güncelle</Text></Pressable>
   <Pressable disabled={busy} accessibilityRole="button" onPress={()=>void replan()}><Text style={styles.link}>Tahmini şarjla yeniden hesapla</Text></Pressable>
   {busy&&<Pressable accessibilityRole="button" onPress={()=>{generation.current++;pending.current?.abort();pending.current=null;setBusy(false);setMessage('Yeniden hesaplama iptal edildi; mevcut rota korunuyor.');}}><Text style={styles.link}>Yeniden hesaplamayı iptal et</Text></Pressable>}
   {!!message&&<Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}
  </View>
  <Pressable accessibilityRole="button" onPress={stop} style={styles.danger}><Ionicons name="stop-circle-outline" size={18} color={c.error}/><Text style={styles.dangerText}>Yolculuğu bitir</Text></Pressable>
  {trip.route.attributions?.map(a=><Pressable key={a.url} accessibilityRole="link" onPress={()=>void Linking.openURL(a.url)}><Text style={styles.notice}>{a.text}</Text></Pressable>)}
  <Text style={styles.notice}>Şarj ve manevralar tahminidir. Takip uygulama açıkken çalışır; düzeltmeler bu cihazda geçici saklanır ve ölçüm yerine öğrenilmez.</Text>
 </View>;
}
const styles=StyleSheet.create({card:{padding:16,borderRadius:18,backgroundColor:c.surface,gap:12,borderWidth:1,borderColor:c.line},alert:{borderColor:c.green,backgroundColor:'#F3F9EC'},
 hero:{padding:18,borderRadius:22,backgroundColor:c.ink,gap:12},heroTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
 back:{flexDirection:'row',alignItems:'center',gap:6,paddingVertical:6,paddingHorizontal:10,borderRadius:14,backgroundColor:'#2B5546'},backText:{color:c.lime,fontWeight:'800',fontSize:13},eyebrow:{color:c.lime,fontSize:10,fontWeight:'800',letterSpacing:1.4},heroTitle:{color:'white',fontSize:24,fontWeight:'800',letterSpacing:-.6},
 heroSlider:{padding:12,borderRadius:16,backgroundColor:'white'},heroNote:{color:'#BFD5C9',fontSize:12,lineHeight:18},heroLink:{color:'#D6E5DC',fontWeight:'700',textAlign:'center',paddingVertical:8},
 primary:{flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',backgroundColor:c.lime,borderRadius:16,paddingVertical:15},primaryText:{color:c.ink,fontWeight:'800',fontSize:15},
 secondary:{borderRadius:14,paddingVertical:13,alignItems:'center',backgroundColor:c.softGreen},secondaryText:{color:c.green,fontWeight:'800'},warning:{color:c.error,fontSize:12,lineHeight:18},
 danger:{flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',paddingVertical:14,borderRadius:16,backgroundColor:c.errorSurface},dangerText:{color:c.error,fontWeight:'800'},
 stopRow:{flexDirection:'row',alignItems:'center',gap:12},stopDot:{width:28,height:28,borderRadius:14,borderWidth:2,borderColor:c.line,alignItems:'center',justifyContent:'center',backgroundColor:'white'},
 stopNext:{borderColor:c.green,backgroundColor:c.lime},stopPassed:{borderColor:c.muted,backgroundColor:c.muted},stopFinish:{borderColor:c.orange,backgroundColor:c.orange},
 stopIndex:{color:c.ink,fontWeight:'800',fontSize:12},stopTitle:{color:c.ink,fontSize:14,fontWeight:'700'},stopMeta:{color:c.muted,fontSize:12,marginTop:2},title:{color:c.ink,fontSize:17,fontWeight:'700'},
 text:{color:c.ink,fontSize:14,lineHeight:22},notice:{color:c.muted,fontSize:12,lineHeight:18},link:{color:c.green,paddingVertical:9,fontWeight:'700'}});
