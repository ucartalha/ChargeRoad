import {useEffect,useRef,useState} from 'react';
import {AppState,Linking,Pressable,StyleSheet,Text,View} from 'react-native';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {Coordinate,PlanningApiRequest,PlanningApiResponse,RoutePlan} from '@chargeroad/shared';
import {planningApi,PlanningApiError} from '../../api/planning';
import {ChargeSlider} from '../planning/ChargeSlider';
import {colors as c} from '../../theme';
import {compactNavigationRoute,locateOnRoute,navigationProgress,replanFromNavigation,validFix} from './navigation-core';
import type {GpsFix,NavigationRoute,NavigationProgress} from './navigation-core';
import {decodeTrip,TRIP_STORAGE_KEY} from './trip-storage';
import type {TripSnapshot} from './trip-storage';

export function NavigationPanel({plan,request,onPlan,onLocation,onRoute,onProgress}:{plan:RoutePlan|null;request:PlanningApiRequest|null;
 onPlan:(result:PlanningApiResponse,request:PlanningApiRequest)=>void;onLocation:(p:Coordinate|null)=>void;onRoute:(r:NavigationRoute|null)=>void;onProgress:(p:NavigationProgress|null)=>void}){
 const [trip,setTrip]=useState<TripSnapshot|null>(null),[charge,setCharge]=useState(''),[message,setMessage]=useState(''),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [foreground,setForeground]=useState(AppState.currentState==='active');
 const [gpsFresh,setGpsFresh]=useState(false);
 const current=useRef<TripSnapshot|null>(null),fixRef=useRef<GpsFix|null>(null),firstFix=useRef(true),lastWrite=useRef(0),queue=useRef(Promise.resolve()),alive=useRef(true);
 const pending=useRef<AbortController|null>(null),generation=useRef(0),offRouteSince=useRef(0),offRouteFixes=useRef(0),nextReplanAt=useRef(0);
 const onPlanRef=useRef(onPlan);onPlanRef.current=onPlan;
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
  try{const updated=replanFromNavigation(t.request,t.route,fix,t.progress,Crypto.randomUUID(),Date.now(),observedSoc);
   setMessage(observedSoc===undefined?'Tahmini şarjla rota yenileniyor; araç göstergesini kontrol et.':'Güncel şarjınla rota yenileniyor.');
   const result=await planningApi.planAsync(updated,controller.signal,(Crypto.randomUUID()+Crypto.randomUUID()).replaceAll('-',''),()=>{});
   if(!alive.current||version!==generation.current)return;
   if(result.status==='planned'){const route=compactNavigationRoute(result.plan),next={...current.current!,request:updated,route,
     anchor:{distance:0,percent:updated.startingChargePercent,observedAt:Date.parse(updated.startingChargeObservedAt),stopId:null},progress:null,updatedAt:Date.now()};
    firstFix.current=false;offRouteSince.current=0;offRouteFixes.current=0;publish(next,true);onRoute(route);onPlanRef.current(result,updated);setMessage('Rota güncellendi. Şarj yüzdesi tahminidir.');
   }else {nextReplanAt.current=Date.now()+Math.max(60,result.metadata.retryAfterSeconds??0)*1000;setMessage(result.reasons.map(r=>r.explanation).join(' '));}
  }catch(error){if(version===generation.current&&!controller.signal.aborted){if(error instanceof PlanningApiError)nextReplanAt.current=Date.now()+Math.max(60,error.retryAfterSeconds)*1000;setMessage(error instanceof Error?error.message:'Rota yenilenemedi.');}}
  finally{if(version===generation.current){pending.current=null;setBusy(false);nextReplanAt.current=Math.max(nextReplanAt.current,Date.now()+60000);}}
 }
 useEffect(()=>{if(!foreground||trip?.status!=='active')return;let disposed=false,subscription:Location.LocationSubscription|undefined;
  const receive=(location:Location.LocationObject)=>{if(disposed)return;const t=current.current;if(!t||t.status!=='active')return;
   const now=Date.now(),fix:GpsFix={latitude:location.coords.latitude,longitude:location.coords.longitude,timestamp:location.timestamp,accuracy:location.coords.accuracy,speed:location.coords.speed};
   if(!validFix(fix,now)){setMessage('Kesin ve güncel GPS konumu bekleniyor; son tahmin korunuyor.');return;}
   const old=fixRef.current;fixRef.current=fix;setGpsFresh(true);onLocation(fix);
   let anchor=t.anchor,initialReplan=false;if(firstFix.current){
    if(now-anchor.observedAt>60000){publish({...t,status:'paused'},true);setMessage('GPS beklenirken şarj doğrulaması eskidi; güncel yüzdeden devam et.');return;}
    const position=locateOnRoute(t.route,fix);if(position&&position.crossTrackMeters<=100)anchor={...anchor,distance:position.distance};
    initialReplan=!!position&&(position.distance>100||position.crossTrackMeters>50||Math.abs(anchor.percent-t.route.segments[0].startSoc)>1);firstFix.current=false;}
   const progress=navigationProgress(t.route,fix,now,anchor,old&&t.progress?{distance:t.progress.distance,timestamp:old.timestamp}:undefined);if(!progress)return;
   publish({...t,anchor,progress,updatedAt:now});
   if(initialReplan&&!pending.current)void replan(anchor.percent);
   if(now-lastWrite.current>=15000){lastWrite.current=now;persist(current.current);}
   if(progress.offRoute){if(!offRouteSince.current)offRouteSince.current=now;offRouteFixes.current++;setMessage('Rotadan uzaklaştın; konum doğrulanıyor.');
    if(offRouteFixes.current>=3&&now-offRouteSince.current>=10000&&!pending.current&&now>=nextReplanAt.current)void replan();
   }else{offRouteSince.current=0;offRouteFixes.current=0;}
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
   events:[...(base?.events??[]),{id:Crypto.randomUUID(),sequence:(base?.events.at(-1)?.sequence??0)+1,at:now,planId:route.planId,percent:value,predictedPercent:base?.anchor.percent??source.startingChargePercent,reason:'start' as const}].slice(-128)};
  fixRef.current=null;firstFix.current=true;nextReplanAt.current=0;publish(next,true);onRoute(route);setCharge('');setMessage('GPS bekleniyor. Bu takip yalnız uygulama ön plandayken çalışır.');
 }
 function correct(afterCharging=false){const t=current.current,fix=fixRef.current;if(!t?.progress||!fix||!validFix(fix,Date.now())||charge===''){setMessage('Güncel GPS ve araç göstergesindeki şarj yüzdesi gerekiyor.');return;}
  const value=Number(charge);if(!Number.isFinite(value)||value<0||value>100)return;
  const stop=afterCharging?t.route.stops.find(s=>Math.abs(s.distance-t.progress!.distance)<=150):undefined,now=Date.now();
  if(afterCharging&&!stop){setMessage('Şarj sonrası doğrulama için planlanan durağa yakın konum gerekiyor. Diğer konumlarda şarj düzeltmesini kullan.');return;}
  const next={...t,updatedAt:now,anchor:{distance:t.progress.distance,percent:value,observedAt:now,stopId:stop?.id??null},events:[...t.events,
    {id:Crypto.randomUUID(),sequence:(t.events.at(-1)?.sequence??0)+1,at:now,planId:t.route.planId,percent:value,predictedPercent:t.progress.soc,reason:stop?'after_charging' as const:'correction' as const}].slice(-128)};
  publish(next,true);setCharge('');void replan(value);
 }
 function stop(){generation.current++;pending.current?.abort();pending.current=null;setBusy(false);publish(null,true);onRoute(null);onLocation(null);fixRef.current=null;setMessage('Yolculuk takibi kapatıldı.');}
 if(!loaded||!plan&&!trip)return null;const p=trip?.progress;
 return <View style={styles.card}><Text style={styles.title}>{trip?'Yolculuk takibi':'Navigasyonu başlat'}</Text>
  {trip&&plan&&plan.planId!==trip.route.planId&&<Text style={styles.notice}>Yeni planı başlatmak için mevcut yolculuk takibini bitir.</Text>}
  {trip?.status==='active'?<>
   <Text style={styles.text}>{p?`Tahmini şarj %${p.soc.toFixed(1)} · ${(p.remainingMeters/1000).toFixed(1)} km kaldı`:'GPS konumu bekleniyor…'}</Text>
   {!gpsFresh&&<Text style={styles.notice}>Güncel GPS bekleniyor; gösterilen değer son tahmindir.</Text>}
   {p&&<Text style={styles.text}>{Math.round(p.instructionDistance)} m · {p.instruction}</Text>}
   {p?.needsChargeConfirmation&&<Text style={styles.notice}>Şarj durağında gerçek şarj yüzdesini gir. Planlanan şarj otomatik olarak gerçekleşmiş sayılmaz.</Text>}
   {p&&p.soc<trip.route.reserve&&<Text style={styles.notice}>Tahmini şarj seçtiğin rezervin altında. Güvenli bir yerde durup araç göstergesini kontrol et.</Text>}
   {p?.arrived&&<Text style={styles.text}>Varış noktasına yaklaştın. Yolculuğu bitirebilirsin.</Text>}
   <ChargeSlider label="Araç göstergesindeki şarj" hint="Düzeltme / şarj sonrası" value={charge} onChange={setCharge}/>
   <Pressable disabled={busy} accessibilityRole="button" onPress={()=>correct(false)}><Text style={styles.link}>Şarjı düzelt ve rotayı güncelle</Text></Pressable>
   {p?.needsChargeConfirmation&&<Pressable disabled={busy} accessibilityRole="button" onPress={()=>correct(true)}><Text style={styles.link}>Şarjım bitti · gerçek yüzdeyle devam et</Text></Pressable>}
   <Pressable disabled={busy} accessibilityRole="button" onPress={()=>void replan()}><Text style={styles.link}>Tahmini şarjla yeniden hesapla</Text></Pressable>
  </>:<><ChargeSlider label="Göstergedeki güncel şarjı doğrula" hint="Navigasyon başlangıcı" value={charge||(!trip?String(request?.startingChargePercent??''):'')} onChange={setCharge}/>
   <Pressable accessibilityRole="button" onPress={start}><Text style={styles.link}>{trip?'Yolculuğa devam et':'Navigasyonu başlat'}</Text></Pressable></>}
  {busy&&<Pressable accessibilityRole="button" onPress={()=>{generation.current++;pending.current?.abort();pending.current=null;setBusy(false);setMessage('Yeniden hesaplama iptal edildi; mevcut rota korunuyor.');}}><Text style={styles.link}>Hesaplama sürüyor · iptal et</Text></Pressable>}
  {trip&&<Pressable accessibilityRole="button" onPress={stop}><Text style={styles.link}>Yolculuğu bitir</Text></Pressable>}
  {!!message&&<Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}
  {trip?.route.attributions?.map(a=><Pressable key={a.url} accessibilityRole="link" onPress={()=>void Linking.openURL(a.url)}><Text style={styles.notice}>{a.text}</Text></Pressable>)}
  <Text style={styles.notice}>Şarj ve manevralar tahminidir. Düzeltmeler bu cihazda geçici saklanır; uygulama kapanınca takip durur. Şarj tahmini ölçüm yerine öğrenilmez.</Text>
 </View>;
}
const styles=StyleSheet.create({card:{padding:16,borderRadius:18,backgroundColor:c.surface,gap:12},title:{color:c.ink,fontSize:17,fontWeight:'700'},
 text:{color:c.ink,fontSize:14,lineHeight:22},notice:{color:c.muted,fontSize:12,lineHeight:18},link:{color:c.green,paddingVertical:9,fontWeight:'700'}});
