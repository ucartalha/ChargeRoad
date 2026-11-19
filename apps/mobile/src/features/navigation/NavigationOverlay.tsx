import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import {useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors as c} from '../../theme';
import type {NavigationProgress,NavigationRoute} from './navigation-core';
import {stepSoc} from './soc-feedback';
import {CLIMB_NOTICE_METERS,climbAhead,formatClock,formatDistance,formatDuration,maneuverIcon,remainingTripSeconds,roadLabel,socOutlook,socStrip,speedLimitAt,speedState,stopCard,upcomingManeuvers} from './navigation-view';

/** Navigation mode step 1 (2026-11-19): top maneuver card. Without fresh GPS it says so instead of guessing a distance. */
export function ManeuverCard({route,progress}:{route:NavigationRoute;progress:NavigationProgress|null}){
  const upcoming=progress?upcomingManeuvers(route,progress.distance):{next:null,then:null};
  const next=upcoming.next,arrived=!!progress?.arrived,wrong=!!progress?.wrongWay&&!arrived;
  return <View style={[s.card,wrong&&{backgroundColor:c.error}]} accessibilityLiveRegion="polite"
    accessibilityLabel={!progress?'GPS konumu bekleniyor':wrong?'Rotanın ters yönündesin':arrived?'Varış noktasına ulaştın':next?`${formatDistance(next.distance)} sonra ${next.instruction}`:'Varış noktasına devam et'}>
    <View style={s.main}>
      <View style={s.arrow}><MaterialCommunityIcons name={!progress?'crosshairs-gps':wrong?'arrow-u-left-top':arrived?'flag-checkered':maneuverIcon(next?.type)} size={40} color={c.lime}/></View>
      <View style={{flex:1}}>
        <Text style={s.distance}>{!progress?'GPS bekleniyor':wrong?'Ters yön':arrived?'Vardın':formatDistance(next?.distance??progress.remainingMeters)}</Text>
        <Text style={s.instruction} numberOfLines={2}>{!progress?'Konumun bulununca yönlendirme başlar':wrong?'Güvenli bir yerde dön; rota yenileniyor':arrived?'Varış noktasına ulaştın':next?.instruction??'Varış noktasına devam et'}</Text>
      </View>
    </View>
    {upcoming.then&&!arrived&&!wrong&&<View style={s.then}><Text style={s.thenText}>Ardından</Text><MaterialCommunityIcons name={maneuverIcon(upcoming.then.type)} size={20} color={c.lime}/></View>}
  </View>;
}

/** Navigation step 1b: top column (maneuver, road/climb chips, next charging stop within 20 km) and bottom-left speed. */
export function NavigationHud({route,progress,confirmedStopId,speed,top,bottom,onCorrectSoc}:{route:NavigationRoute;progress:NavigationProgress|null;
  confirmedStopId:string|null;speed:number|null|undefined;top:number;bottom:number;onCorrectSoc?:(percent:number)=>string|null}){
  const road=progress?roadLabel(route,progress.distance):null,climb=progress?climbAhead(route,progress.distance):0;
  const card=progress?stopCard(route,progress,confirmedStopId):null,limit=progress?speedLimitAt(route,progress.distance):null,state=speedState(speed,limit);
  return <>
    <View pointerEvents="box-none" style={[s.column,{top}]}>
      <ManeuverCard route={route} progress={progress}/>
      {(road||climb>=CLIMB_NOTICE_METERS||progress)&&<View style={s.chips}>
        {road&&<View style={s.chip}><MaterialCommunityIcons name={road==='Otoyol'?'highway':'road-variant'} size={14} color={c.green}/><Text style={s.chipText}>{road}</Text></View>}
        {climb>=CLIMB_NOTICE_METERS&&<View style={s.chip}><MaterialCommunityIcons name="trending-up" size={14} color={c.orange}/><Text style={s.chipText}>10 km'de +{climb} m tırmanış · tüketim artar</Text></View>}
        {/* Top right: estimated SOC chip. */}
        {progress&&<SocChip soc={progress.soc} onCorrect={onCorrectSoc}/>}
      </View>}
      {card&&<View style={s.stop} accessibilityLabel={`${card.index}. şarj durağına ${formatDistance(card.distance)}`}>
        <View style={s.stopIcon}><MaterialCommunityIcons name="ev-station" size={22} color={c.ink}/></View>
        <View style={{flex:1}}><Text style={s.stopTitle}>{card.index}. şarj durağı · {formatDistance(card.distance)}</Text>
          <Text style={s.stopText}>Varış ~%{Math.round(card.arrivalSoc)} → hedef %{Math.round(card.targetSoc)}{card.seconds?` · ~${formatDuration(card.seconds)}`:''}</Text></View>
      </View>}
    </View>
    {progress&&<View pointerEvents="none" style={[s.speedRow,{bottom}]}>
      <View style={[s.speed,state.over&&s.speedOver]} accessibilityLabel={state.kph===null?'Hız bilinmiyor':`Hız ${state.kph} kilometre`}>
        <Text style={[s.speedValue,state.over&&{color:'white'}]}>{state.kph??'—'}</Text><Text style={[s.speedUnit,state.over&&{color:'white'}]}>km/s</Text></View>
      {limit!==null&&<View style={s.limit} accessibilityLabel={`Hız limiti ${limit}`}><Text style={s.limitValue}>{limit}</Text></View>}
    </View>}
  </>;
}

/**
 * SOC chip (2026-11-19, user request): top right, our ESTIMATED SOC. Tapping opens − / + (long press ±5) to enter the dashboard
 * value; saving re-anchors the trip, replans from it and records the estimate error (soc-feedback.ts). Never shown as measured.
 */
export function SocChip({soc,onCorrect}:{soc:number;onCorrect?:(percent:number)=>string|null}){
  const [value,setValue]=useState<number|null>(null),[error,setError]=useState('');
  if(value===null)return <Pressable testID="nav-soc-chip" accessibilityRole="button" disabled={!onCorrect} accessibilityLabel={`Tahmini şarj yüzde ${Math.round(soc)}. Gerçek şarjı girmek için dokun`}
    onPress={()=>{setError('');setValue(Math.round(soc));}} style={s.socChip}>
    <MaterialCommunityIcons name="battery-medium" size={15} color={c.green}/><Text style={s.socValue}>%{Math.round(soc)}</Text><Text style={s.socLabel}>tahmini</Text></Pressable>;
  const step=(delta:number)=>{setError('');setValue(v=>stepSoc(v??soc,delta));};
  return <View style={s.socEdit} accessibilityLabel="Göstergedeki şarjı gir">
    <Text style={s.socEditTitle}>Göstergedeki şarj</Text>
    <View style={s.socRow}>
      <Pressable testID="nav-soc-minus" accessibilityRole="button" accessibilityLabel="Bir azalt" onPress={()=>step(-1)} onLongPress={()=>step(-5)} style={s.socStep}><Ionicons name="remove" size={22} color={c.ink}/></Pressable>
      <Text style={s.socEditValue} accessibilityLiveRegion="polite">%{value}</Text>
      <Pressable testID="nav-soc-plus" accessibilityRole="button" accessibilityLabel="Bir artır" onPress={()=>step(1)} onLongPress={()=>step(5)} style={s.socStep}><Ionicons name="add" size={22} color={c.ink}/></Pressable>
    </View>
    <Text style={s.socHint}>Tahmin %{Math.round(soc)} · uzun bas ±5</Text>
    {!!error&&<Text style={s.socError}>{error}</Text>}
    <View style={s.socRow}>
      <Pressable accessibilityRole="button" onPress={()=>{setValue(null);setError('');}} style={s.socCancel}><Text style={s.socCancelText}>Vazgeç</Text></Pressable>
      <Pressable testID="nav-soc-save" accessibilityRole="button" onPress={()=>{const message=onCorrect?.(value)??null;if(message)setError(message);else setValue(null);}} style={s.socSave}><Text style={s.socSaveText}>Kaydet</Text></Pressable>
    </View>
  </View>;
}

/** Bottom bar (sheet peek in navigation mode): arrival clock, remaining time/distance, next charge or arrival SOC estimate. */
export function NavigationBar({route,progress,confirmedStopId,now,onExit,onDetails}:{route:NavigationRoute;progress:NavigationProgress|null;
  confirmedStopId:string|null;now:number;onExit:()=>void;onDetails:()=>void}){
  const outlook=progress?socOutlook(route,progress,confirmedStopId):null,seconds=progress?remainingTripSeconds(route,progress,confirmedStopId):null;
  return <View style={s.bar}>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Navigasyondan çık" onPress={onExit} style={s.exit}><Ionicons name="close" size={24} color={c.error}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Yolculuk ayrıntılarını aç" onPress={onDetails} style={{flex:1,alignItems:'center'}}>
        <Text style={s.eta}>{seconds===null?'—':formatClock(now+seconds*1000)}<Text style={s.etaLabel}>  varış</Text></Text>
        <Text style={s.meta}>{seconds===null?'GPS bekleniyor':`${formatDuration(seconds)} · ${formatDistance(progress!.remainingMeters)}`}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Şarj ve rota ayrıntıları" onPress={onDetails} style={s.details}><Ionicons name="chevron-up" size={22} color={c.green}/></Pressable>
    </View>
    {progress&&<SocStrip route={route} progress={progress} confirmedStopId={confirmedStopId}/>}
    {outlook&&<Pressable accessibilityRole="button" onPress={onDetails} style={[s.soc,progress!.soc<route.reserve&&s.socWarn]}>
      <MaterialCommunityIcons name={outlook.kind==='stop'?'ev-station':'flag-checkered'} size={18} color={c.green}/>
      <Text style={s.socText} numberOfLines={1}>{progress!.needsChargeConfirmation?'Şarj durağındasın · gerçek yüzdeyi gir':
        outlook.kind==='stop'?`Şarja ${formatDistance(outlook.distance)} · varış ~%${Math.round(outlook.soc)} → %${Math.round(outlook.targetSoc!)}`:
        `Varışta ~%${Math.round(outlook.soc)} · şimdi ~%${Math.round(progress!.soc)}`}</Text>
      <Text style={s.estimate}>tahmini</Text>
    </Pressable>}
  </View>;
}
function SocStrip({route,progress,confirmedStopId}:{route:NavigationRoute;progress:NavigationProgress;confirmedStopId:string|null}){
  const strip=socStrip(route,progress,confirmedStopId),pct=(v:number)=>`${Math.max(0,Math.min(100,v))}%` as const;
  const low=strip.soc<strip.reserve,delta=strip.planDelta;
  return <View style={s.strip} accessibilityLabel={`Tahmini şarj yüzde ${Math.round(strip.soc)}, rezerv yüzde ${strip.reserve}`}>
    <View style={s.track}><View style={[s.fill,{width:pct(strip.soc)},low&&{backgroundColor:c.error}]}/>
      <View style={[s.reserveTick,{left:pct(strip.reserve)}]}/>
      {strip.nextStopSoc!==null&&<View style={[s.stopTick,{left:pct(strip.nextStopSoc)}]}/>}</View>
    <Text style={s.stripText}>%{Math.round(strip.soc)}{delta!==null&&Math.abs(delta)>=1?` · plana göre ${delta>0?'+':'−'}${Math.round(Math.abs(delta))}`:''}</Text>
  </View>;
}
export const NAVIGATION_BAR_HEIGHT=178;
const s=StyleSheet.create({
  column:{position:'absolute',left:12,right:12,gap:8},chips:{flexDirection:'row',flexWrap:'wrap',gap:6,alignItems:'flex-start'},
  socChip:{marginLeft:'auto',flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:10,paddingVertical:6,borderRadius:14,backgroundColor:'white',elevation:3,borderWidth:1,borderColor:c.line},
  socValue:{color:c.ink,fontSize:15,fontWeight:'800'},socLabel:{color:c.muted,fontSize:10,fontWeight:'700'},
  socEdit:{marginLeft:'auto',width:210,padding:12,borderRadius:18,backgroundColor:'white',elevation:6,gap:8},socEditTitle:{color:c.ink,fontSize:13,fontWeight:'800'},
  socRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},socStep:{width:48,height:48,borderRadius:24,backgroundColor:c.softGreen,alignItems:'center',justifyContent:'center'},
  socEditValue:{color:c.ink,fontSize:28,fontWeight:'800',minWidth:70,textAlign:'center'},socHint:{color:c.muted,fontSize:11,textAlign:'center'},socError:{color:c.error,fontSize:11,lineHeight:16},
  socCancel:{flex:1,paddingVertical:10,borderRadius:12,alignItems:'center',backgroundColor:c.surface,borderWidth:1,borderColor:c.line},socCancelText:{color:c.ink,fontWeight:'700'},
  socSave:{flex:1,paddingVertical:10,borderRadius:12,alignItems:'center',backgroundColor:c.lime},socSaveText:{color:c.ink,fontWeight:'800'},
  chip:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:10,paddingVertical:6,borderRadius:14,backgroundColor:'white',elevation:3},chipText:{color:c.ink,fontSize:12,fontWeight:'700'},
  stop:{flexDirection:'row',alignItems:'center',gap:12,padding:12,borderRadius:18,backgroundColor:c.lime,elevation:5},stopIcon:{width:40,height:40,borderRadius:12,backgroundColor:'rgba(255,255,255,.6)',alignItems:'center',justifyContent:'center'},
  stopTitle:{color:c.ink,fontSize:15,fontWeight:'800'},stopText:{color:c.ink,fontSize:12,fontWeight:'600',marginTop:2},
  speedRow:{position:'absolute',left:14,flexDirection:'row',alignItems:'flex-end',gap:8},
  speed:{width:66,height:66,borderRadius:33,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:6},speedOver:{backgroundColor:c.error},
  speedValue:{color:c.ink,fontSize:24,fontWeight:'800',lineHeight:26},speedUnit:{color:c.muted,fontSize:10,fontWeight:'700'},
  limit:{width:46,height:46,borderRadius:23,backgroundColor:'white',borderWidth:4,borderColor:'#D23B2F',alignItems:'center',justifyContent:'center',elevation:6},limitValue:{color:'#111',fontSize:17,fontWeight:'800'},
  strip:{flexDirection:'row',alignItems:'center',gap:10},track:{flex:1,height:8,borderRadius:4,backgroundColor:'#E2E8E0',overflow:'visible'},
  fill:{position:'absolute',left:0,top:0,bottom:0,borderRadius:4,backgroundColor:c.green},reserveTick:{position:'absolute',top:-3,width:2,height:14,backgroundColor:c.error},
  stopTick:{position:'absolute',top:-3,width:8,height:14,marginLeft:-4,borderRadius:3,backgroundColor:c.lime,borderWidth:1,borderColor:c.ink},stripText:{color:c.ink,fontSize:12,fontWeight:'800',minWidth:96,textAlign:'right'},
  card:{borderRadius:22,backgroundColor:c.green,overflow:'hidden',elevation:8,shadowColor:'#000',shadowOpacity:.2,shadowRadius:12,shadowOffset:{width:0,height:4}},
  main:{flexDirection:'row',alignItems:'center',gap:14,padding:16},arrow:{width:56,height:56,borderRadius:16,backgroundColor:'rgba(255,255,255,.08)',alignItems:'center',justifyContent:'center'},
  distance:{color:'white',fontSize:30,fontWeight:'800',letterSpacing:-.8},instruction:{color:'#DCE9E2',fontSize:16,fontWeight:'600',marginTop:2},
  then:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingVertical:8,backgroundColor:'#1B3B2F'},thenText:{color:'#DCE9E2',fontSize:13,fontWeight:'700'},
  bar:{paddingHorizontal:18,gap:10},row:{flexDirection:'row',alignItems:'center',gap:12},
  exit:{width:46,height:46,borderRadius:23,backgroundColor:c.errorSurface,alignItems:'center',justifyContent:'center'},
  details:{width:46,height:46,borderRadius:23,backgroundColor:c.softGreen,alignItems:'center',justifyContent:'center'},
  eta:{color:c.ink,fontSize:26,fontWeight:'800',letterSpacing:-.6},etaLabel:{fontSize:13,fontWeight:'600',color:c.muted},meta:{color:c.muted,fontSize:14,fontWeight:'600',marginTop:2},
  soc:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,paddingVertical:10,borderRadius:14,backgroundColor:c.softGreen},socWarn:{backgroundColor:c.errorSurface},
  socText:{flex:1,color:c.ink,fontSize:13,fontWeight:'700'},estimate:{color:c.muted,fontSize:11}});
