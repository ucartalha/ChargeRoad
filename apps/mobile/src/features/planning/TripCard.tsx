import {useEffect,useRef} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {Animated,StyleSheet,Text,View} from 'react-native';
import {PressableScale} from '../../ui/PressableScale';
import {EnergySkyline} from './EnergySkyline';
import {formatDuration,formatKm,tripFacts} from './trip-summary';
import type {TripActions,TripState} from './trip-summary';
import {planNotices} from './planning-flow';
import {colors as c} from '../../theme';

/** The collapsed sheet's live card: planning progress, the finished trip at a glance, or what to fix. */
export function TripCard({trip,actions,onOpen}:{trip:Exclude<TripState,{phase:'idle'}>;actions:TripActions;onOpen:()=>void}){
  const enter=useRef(new Animated.Value(0)).current;
  useEffect(()=>{enter.setValue(0);Animated.spring(enter,{toValue:1,useNativeDriver:true,speed:16,bounciness:5}).start();},[trip.phase,enter]);
  const motion={opacity:enter,transform:[{translateY:enter.interpolate({inputRange:[0,1],outputRange:[14,0]})}]};
  if(trip.phase==='failed')return <Animated.View testID="trip-card-failed" style={[s.card,s.soft,motion]}>
    <View style={s.row}><View style={[s.icon,s.warnIcon]}><Ionicons name="alert" size={20} color={c.orange}/></View>
      <View style={s.flex}><Text style={s.softTitle}>{trip.title}</Text><Text numberOfLines={2} style={s.softText}>{trip.message}</Text></View></View>
    <PressableScale accessibilityRole="button" onPress={onOpen} style={s.softButton}><Text style={s.softButtonText}>Tercihleri düzenle</Text></PressableScale>
  </Animated.View>;
  const plan=trip.phase==='planned'?trip.plan:null,facts=plan?tripFacts(plan):null;
  const notice=plan?planNotices(plan,trip.phase==='planned'?trip.requestedArrival:null)[0]:null;
  return <Animated.View testID={plan?'trip-card-planned':'trip-card-planning'} style={[s.card,motion]}>
    <View style={s.row}>
      <View style={s.flex}>
        <Text style={s.eyebrow}>{plan?'YOLCULUĞUN HAZIR':trip.phase==='planning'&&trip.queued?'SIRADA':'HESAPLANIYOR'}</Text>
        <Text style={s.big}>{facts?facts.duration:trip.phase==='planning'&&trip.preview?formatKm(trip.preview.distanceMeters):'Rotan hazırlanıyor'}</Text>
        <Text style={s.sub}>{facts?`${facts.distance} · ${facts.stops} · varış ${facts.arrival}`:
          trip.phase==='planning'&&trip.preview?`${formatDuration(trip.preview.drivingSeconds)} sürüş · şarj molaları hesaplanıyor`:'Yol, hava ve şarj noktaları birleştiriliyor'}</Text>
      </View>
      {plan?<PressableScale accessibilityRole="button" accessibilityLabel="Rotayı temizle" onPress={actions.reset} style={s.iconButton}><Ionicons name="close" size={18} color="#D6E5DC"/></PressableScale>:null}
    </View>
    <EnergySkyline plan={plan} start={plan?`%${Math.round(plan.energySegments[0]?.startChargePercent??0)} ŞİMDİ`:undefined} arrival={facts?`${facts.arrival} VARIŞ`:undefined}/>
    {notice&&<Text style={s.notice}>{notice}</Text>}
    {plan?<View style={s.actions}>
        <PressableScale testID="trip-start-navigation" accessibilityRole="button" accessibilityLabel="Navigasyonu başlat" onPress={onOpen} style={[s.primary,s.flex]}>
          <Ionicons name="navigate" size={17} color={c.ink}/><Text style={s.primaryText}>Navigasyonu başlat</Text></PressableScale>
        <PressableScale testID="trip-open-details" accessibilityRole="button" accessibilityLabel="Molaları ve ayrıntıları gör" onPress={onOpen} style={s.more}>
          <Ionicons name="list" size={20} color="#D6E5DC"/></PressableScale></View>:
      <PressableScale testID="trip-cancel" accessibilityRole="button" onPress={actions.cancel} style={s.ghost}><Text style={s.ghostText}>İptal et</Text></PressableScale>}
  </Animated.View>;
}
const s=StyleSheet.create({flex:{flex:1},actions:{flexDirection:"row",gap:10},more:{width:52,borderRadius:16,borderWidth:1,borderColor:"#3D6B58",alignItems:"center",justifyContent:"center"},card:{backgroundColor:c.ink,borderRadius:24,padding:18,gap:14,marginHorizontal:16},row:{flexDirection:'row',alignItems:'flex-start',gap:12},
  eyebrow:{color:c.lime,fontSize:10,fontWeight:'800',letterSpacing:1.4},big:{color:'white',fontSize:30,fontWeight:'800',letterSpacing:-1.2,marginTop:2},sub:{color:'#BFD5C9',fontSize:12,marginTop:2},
  iconButton:{width:34,height:34,borderRadius:17,backgroundColor:'#2B5546',alignItems:'center',justifyContent:'center'},
  notice:{color:c.lime,fontSize:11,lineHeight:17},primary:{backgroundColor:c.lime,borderRadius:16,paddingVertical:14,flexDirection:'row',justifyContent:'center',alignItems:'center',gap:8},
  primaryText:{color:c.ink,fontWeight:'800',fontSize:14},ghost:{borderWidth:1,borderColor:'#3D6B58',borderRadius:16,paddingVertical:12,alignItems:'center'},ghostText:{color:'#D6E5DC',fontWeight:'700'},
  soft:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line},icon:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},warnIcon:{backgroundColor:c.errorSurface},
  softTitle:{color:c.ink,fontSize:16,fontWeight:'800'},softText:{color:c.muted,fontSize:12,lineHeight:18,marginTop:3},
  softButton:{backgroundColor:c.ink,borderRadius:16,paddingVertical:13,alignItems:'center'},softButtonText:{color:c.lime,fontWeight:'800'}});
