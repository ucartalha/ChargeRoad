import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors as c} from '../../theme';
import type {NavigationProgress,NavigationRoute} from './navigation-core';
import {formatClock,formatDistance,formatDuration,maneuverIcon,remainingTripSeconds,socOutlook,upcomingManeuvers} from './navigation-view';

/** Navigation mode step 1 (2026-11-19): top maneuver card. Without fresh GPS it says so instead of guessing a distance. */
export function ManeuverCard({route,progress,top}:{route:NavigationRoute;progress:NavigationProgress|null;top:number}){
  const upcoming=progress?upcomingManeuvers(route,progress.distance):{next:null,then:null};
  const next=upcoming.next,arrived=!!progress?.arrived;
  return <View style={[s.card,{top}]} accessibilityLiveRegion="polite"
    accessibilityLabel={!progress?'GPS konumu bekleniyor':arrived?'Varış noktasına ulaştın':next?`${formatDistance(next.distance)} sonra ${next.instruction}`:'Varış noktasına devam et'}>
    <View style={s.main}>
      <View style={s.arrow}><MaterialCommunityIcons name={!progress?'crosshairs-gps':arrived?'flag-checkered':maneuverIcon(next?.type)} size={40} color={c.lime}/></View>
      <View style={{flex:1}}>
        <Text style={s.distance}>{!progress?'GPS bekleniyor':arrived?'Vardın':formatDistance(next?.distance??progress.remainingMeters)}</Text>
        <Text style={s.instruction} numberOfLines={2}>{!progress?'Konumun bulununca yönlendirme başlar':arrived?'Varış noktasına ulaştın':next?.instruction??'Varış noktasına devam et'}</Text>
      </View>
    </View>
    {upcoming.then&&!arrived&&<View style={s.then}><Text style={s.thenText}>Ardından</Text><MaterialCommunityIcons name={maneuverIcon(upcoming.then.type)} size={20} color={c.lime}/></View>}
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
    {outlook&&<Pressable accessibilityRole="button" onPress={onDetails} style={[s.soc,progress!.soc<route.reserve&&s.socWarn]}>
      <MaterialCommunityIcons name={outlook.kind==='stop'?'ev-station':'flag-checkered'} size={18} color={c.green}/>
      <Text style={s.socText} numberOfLines={1}>{progress!.needsChargeConfirmation?'Şarj durağındasın · gerçek yüzdeyi gir':
        outlook.kind==='stop'?`Şarja ${formatDistance(outlook.distance)} · varış ~%${Math.round(outlook.soc)} → %${Math.round(outlook.targetSoc!)}`:
        `Varışta ~%${Math.round(outlook.soc)} · şimdi ~%${Math.round(progress!.soc)}`}</Text>
      <Text style={s.estimate}>tahmini</Text>
    </Pressable>}
  </View>;
}
export const NAVIGATION_BAR_HEIGHT=150;
const s=StyleSheet.create({
  card:{position:'absolute',left:12,right:12,borderRadius:22,backgroundColor:c.green,overflow:'hidden',elevation:8,shadowColor:'#000',shadowOpacity:.2,shadowRadius:12,shadowOffset:{width:0,height:4}},
  main:{flexDirection:'row',alignItems:'center',gap:14,padding:16},arrow:{width:56,height:56,borderRadius:16,backgroundColor:'rgba(255,255,255,.08)',alignItems:'center',justifyContent:'center'},
  distance:{color:'white',fontSize:30,fontWeight:'800',letterSpacing:-.8},instruction:{color:'#DCE9E2',fontSize:16,fontWeight:'600',marginTop:2},
  then:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingVertical:8,backgroundColor:'#1B3B2F'},thenText:{color:'#DCE9E2',fontSize:13,fontWeight:'700'},
  bar:{paddingHorizontal:18,gap:10},row:{flexDirection:'row',alignItems:'center',gap:12},
  exit:{width:46,height:46,borderRadius:23,backgroundColor:c.errorSurface,alignItems:'center',justifyContent:'center'},
  details:{width:46,height:46,borderRadius:23,backgroundColor:c.softGreen,alignItems:'center',justifyContent:'center'},
  eta:{color:c.ink,fontSize:26,fontWeight:'800',letterSpacing:-.6},etaLabel:{fontSize:13,fontWeight:'600',color:c.muted},meta:{color:c.muted,fontSize:14,fontWeight:'600',marginTop:2},
  soc:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,paddingVertical:10,borderRadius:14,backgroundColor:c.softGreen},socWarn:{backgroundColor:c.errorSurface},
  socText:{flex:1,color:c.ink,fontSize:13,fontWeight:'700'},estimate:{color:c.muted,fontSize:11}});
